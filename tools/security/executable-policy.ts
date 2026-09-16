import { lstat, readdir, readFile } from "node:fs/promises";
import {
  basename,
  dirname,
  extname,
  join,
  normalize,
  posix,
  relative,
  resolve,
  sep,
  win32,
} from "node:path";

import { parse } from "acorn";
import { analyze, type Reference, type Variable } from "eslint-scope";
import { parse as parseHtml } from "parse5";

export type ExecutablePolicyViolation = Readonly<{
  file: string;
  rule: string;
}>;

type AstNode = Readonly<{ type: string; [key: string]: unknown }>;
const Provenance = {
  Unknown: 0,
  Eval: 1,
  Function: 2,
  GlobalThis: 4,
} as const;

type Origin = number;
type HtmlNode = {
  nodeName?: string;
  tagName?: string;
  attrs?: Array<{ name: string; value: string }>;
  childNodes?: HtmlNode[];
  value?: string;
};

const executableExtensions = new Set([".html", ".js", ".mjs"]);
const remoteUrl = /^(?:https?:)?\/\//iu;
const nonExecutableScriptTypes = new Set(["application/json"]);

function parsedProgram(source: string, sourceType: "module" | "script"): AstNode | null {
  try {
    return parse(source, { ecmaVersion: "latest", sourceType }) as unknown as AstNode;
  } catch {
    return null;
  }
}

export function verifyInertContentSource(source: string): string[] {
  const program = parsedProgram(source, "module");
  if (program === null || !Array.isArray(program.body)) return ["non-inert-content-source"];
  const inert = program.body.every((statementValue) => {
    const statement = node(statementValue);
    return (
      statement?.type === "ExportNamedDeclaration" &&
      statement.declaration === null &&
      statement.source === null &&
      Array.isArray(statement.specifiers) &&
      statement.specifiers.length === 0
    );
  });
  return inert ? [] : ["non-inert-content-source"];
}

function harmlessWrapperBody(value: unknown): boolean {
  const body = node(value);
  if (body?.type !== "BlockStatement" || !Array.isArray(body.body)) return false;
  if (body.body.length === 0) return true;
  if (body.body.length !== 1) return false;
  const statement = node(body.body[0]);
  return (
    statement?.type === "ExpressionStatement" &&
    statement.directive === "use strict" &&
    staticString(statement.expression) === "use strict"
  );
}

export function verifyInertContentEntry(source: string): string[] {
  const program = parsedProgram(source, "script");
  if (program === null || !Array.isArray(program.body) || program.body.length !== 1)
    return ["non-inert-content-entry"];
  const statement = node(program.body[0]);
  const call = node(statement?.expression);
  const wrapper = node(call?.callee);
  const inert =
    statement?.type === "ExpressionStatement" &&
    call?.type === "CallExpression" &&
    call.optional !== true &&
    Array.isArray(call.arguments) &&
    call.arguments.length === 0 &&
    (wrapper?.type === "FunctionExpression" || wrapper?.type === "ArrowFunctionExpression") &&
    wrapper.async !== true &&
    wrapper.generator !== true &&
    Array.isArray(wrapper.params) &&
    wrapper.params.length === 0 &&
    harmlessWrapperBody(wrapper.body);
  return inert ? [] : ["non-inert-content-entry"];
}

async function executableEntries(
  directory: string,
): Promise<{ files: string[]; violations: ExecutablePolicyViolation[] }> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  const violations: ExecutablePolicyViolation[] = [];
  for (const entry of entries) {
    const candidate = join(directory, entry.name);
    const metadata = await lstat(candidate);
    if (metadata.isSymbolicLink() || (!metadata.isDirectory() && !metadata.isFile())) {
      violations.push({ file: candidate, rule: "nonregular-executable-entry" });
    } else if (metadata.isDirectory()) {
      const nested = await executableEntries(candidate);
      files.push(...nested.files);
      violations.push(...nested.violations);
    } else if (executableExtensions.has(extname(entry.name).toLowerCase())) {
      files.push(candidate);
    }
  }
  return { files, violations };
}

function node(value: unknown): AstNode | null {
  if (typeof value !== "object" || value === null || !("type" in value)) return null;
  return value as AstNode;
}

function identifierName(value: unknown): string | null {
  const candidate = node(value);
  return candidate?.type === "Identifier" && typeof candidate.name === "string"
    ? candidate.name
    : null;
}

function staticString(value: unknown): string | null {
  const candidate = node(value);
  if (candidate?.type === "Literal" && typeof candidate.value === "string") return candidate.value;
  if (
    candidate?.type === "TemplateLiteral" &&
    Array.isArray(candidate.expressions) &&
    candidate.expressions.length === 0 &&
    Array.isArray(candidate.quasis)
  ) {
    const quasi = node(candidate.quasis[0]);
    const cooked = node(quasi?.value)?.cooked;
    return typeof cooked === "string" ? cooked : null;
  }
  return null;
}

function memberProperty(value: AstNode): string | null {
  if (value.type !== "MemberExpression") return null;
  return value.computed === true ? staticString(value.property) : identifierName(value.property);
}

const AUDITED_PROTOBUF_REGISTRY = "@bufbuild/protobuf/text-encoding";

function isAuditedProtobufRegistryKey(value: unknown, analysis: BindingAnalysis): boolean {
  const candidate = node(value);
  if (candidate === null) return false;
  if (candidate.type === "CallExpression") {
    const callee = node(candidate.callee);
    const args = Array.isArray(candidate.arguments) ? candidate.arguments : [];
    return (
      callee?.type === "MemberExpression" &&
      identifierName(callee.object) === "Symbol" &&
      memberProperty(callee) === "for" &&
      args.length === 1 &&
      staticString(args[0]) === AUDITED_PROTOBUF_REGISTRY
    );
  }
  if (candidate.type !== "Identifier") return false;
  const binding = bindingForIdentifier(candidate, analysis);
  if (binding === null) return false;
  return binding.defs.some((definition) => {
    const declarator = node(definition.node);
    return (
      declarator?.type === "VariableDeclarator" &&
      isAuditedProtobufRegistryKey(declarator.init, analysis)
    );
  });
}

function isAuditedProtobufRegistryAccess(value: AstNode, analysis: BindingAnalysis): boolean {
  return (
    value.type === "MemberExpression" &&
    value.computed === true &&
    hasOrigin(expressionOrigin(value.object, analysis), Provenance.GlobalThis) &&
    isAuditedProtobufRegistryKey(value.property, analysis)
  );
}

function unwrapChain(value: unknown): AstNode | null {
  const candidate = node(value);
  return candidate?.type === "ChainExpression" ? node(candidate.expression) : candidate;
}

function patternIdentifiers(value: unknown): AstNode[] {
  const candidate = node(value);
  if (candidate === null) return [];
  if (candidate.type === "Identifier") return [candidate];
  if (candidate.type === "AssignmentPattern") return patternIdentifiers(candidate.left);
  if (candidate.type === "RestElement") return patternIdentifiers(candidate.argument);
  if (candidate.type === "ArrayPattern" && Array.isArray(candidate.elements)) {
    return candidate.elements.flatMap(patternIdentifiers);
  }
  if (candidate.type === "ObjectPattern" && Array.isArray(candidate.properties)) {
    return candidate.properties.flatMap((propertyValue) => {
      const property = node(propertyValue);
      return property?.type === "Property"
        ? patternIdentifiers(property.value)
        : patternIdentifiers(property?.argument);
    });
  }
  return [];
}

function childNodes(value: AstNode): AstNode[] {
  const children: AstNode[] = [];
  for (const [key, item] of Object.entries(value)) {
    if (key === "type" || key === "start" || key === "end") continue;
    if (key === "property" && value.type === "MemberExpression" && value.computed !== true)
      continue;
    if (key === "key" && value.type === "Property" && value.computed !== true) continue;
    const direct = node(item);
    if (direct !== null) children.push(direct);
    if (Array.isArray(item)) {
      for (const entry of item) {
        const child = node(entry);
        if (child !== null) children.push(child);
      }
    }
  }
  return children;
}

function pathIsWithin(parent: string, candidate: string): boolean {
  const fromParent = relative(resolve(parent), resolve(candidate));
  return (
    fromParent === "" ||
    (!fromParent.startsWith(`..${sep}`) &&
      fromParent !== ".." &&
      !posix.isAbsolute(fromParent) &&
      !win32.isAbsolute(fromParent))
  );
}

function isLegacyTarget(candidate: string, distRoot: string): boolean {
  const projectRoot = dirname(resolve(distRoot));
  const assetsRoot = resolve(projectRoot, "assets");
  return (
    pathIsWithin(assetsRoot, candidate) ||
    resolve(candidate) === resolve(projectRoot, "service-worker-loader.js") ||
    resolve(candidate) === resolve(projectRoot, "src/popup/index.html")
  );
}

function modulePathRule(specifier: string, file: string, root: string): string | null {
  if (remoteUrl.test(specifier)) return "remote-module-url";

  const posixAbsolute = posix.isAbsolute(specifier);
  const windowsAbsolute = win32.isAbsolute(specifier);
  if (!specifier.startsWith(".") && !posixAbsolute && !windowsAbsolute) return null;

  const absolute = posixAbsolute
    ? resolve(specifier)
    : windowsAbsolute
      ? null
      : resolve(dirname(file), normalize(specifier));
  if (absolute === null) return "module-import-outside-dist";
  if (pathIsWithin(root, absolute)) return null;
  return isLegacyTarget(absolute, root) ? "legacy-source-import" : "module-import-outside-dist";
}

function moduleSpecifierRule(
  value: unknown,
  file: string,
  root: string,
  dynamic: boolean,
): string | null {
  const specifier = staticString(value);
  if (specifier === null)
    return dynamic ? "computed-dynamic-import" : "non-static-module-specifier";
  return modulePathRule(specifier, file, root);
}

type BindingAnalysis = {
  bindingByIdentifier: Map<AstNode, Variable>;
  referenceByIdentifier: Map<AstNode, Reference>;
  originByBinding: Map<Variable, Origin>;
};

type ExecutableReference = Readonly<{ file: string; type: "html" | "javascript" }>;

function isUnshadowedGlobal(value: unknown, name: string, analysis: BindingAnalysis): boolean {
  const identifier = node(value);
  if (identifier?.type !== "Identifier" || identifierName(identifier) !== name) return false;
  const reference = analysis.referenceByIdentifier.get(identifier);
  return reference?.resolved === null || reference?.resolved === undefined;
}

function localExecutableReference(
  specifier: string,
  file: string,
  root: string,
  type: "html" | "javascript",
  references: ExecutableReference[],
  violations: Set<string>,
): void {
  if (remoteUrl.test(specifier)) {
    violations.add("remote-executable-resource");
    return;
  }
  if (!specifier.startsWith(".") && !specifier.startsWith("/")) {
    violations.add("computed-executable-url");
    return;
  }
  const candidate = specifier.startsWith("/")
    ? resolve(root, specifier.slice(1))
    : resolve(dirname(file), normalize(specifier));
  if (!pathIsWithin(root, candidate)) {
    violations.add("module-import-outside-dist");
    return;
  }
  references.push({ file: candidate, type });
}

function staticUrlSpecifier(value: unknown): string | null {
  const direct = staticString(value);
  if (direct !== null) return direct;
  const expression = unwrapChain(value);
  if (expression?.type !== "NewExpression") return null;
  const callee = unwrapChain(expression.callee);
  if (callee?.type !== "Identifier" || callee.name !== "URL") return null;
  const argumentsList = Array.isArray(expression.arguments) ? expression.arguments : [];
  const base = unwrapChain(argumentsList[1]);
  const importMeta = base?.type === "MemberExpression" ? unwrapChain(base.object) : null;
  if (
    base === null ||
    memberProperty(base) !== "url" ||
    importMeta?.type !== "MetaProperty" ||
    identifierName(importMeta.meta) !== "import" ||
    identifierName(importMeta.property) !== "meta"
  ) {
    return null;
  }
  return staticString(argumentsList[0]);
}

function executableUrlArgument(
  value: unknown,
  file: string,
  root: string,
  references: ExecutableReference[],
  violations: Set<string>,
): void {
  const specifier = staticUrlSpecifier(value);
  if (specifier === null) {
    violations.add("computed-executable-url");
    return;
  }
  localExecutableReference(specifier, file, root, "javascript", references, violations);
}

function networkUrlArgument(value: unknown, violations: Set<string>): void {
  const specifier = staticString(value);
  if (
    specifier === null ||
    /^(?:https?:|wss?:|\/\/)/iu.test(specifier.trim()) ||
    (!specifier.startsWith(".") && !specifier.startsWith("/"))
  ) {
    violations.add("network-destination");
  }
}

type ResourceKind = "image" | "media" | "xhr";

function resourceBindingForValue(value: unknown, analysis: BindingAnalysis): Variable | null {
  const identifier = node(value);
  if (identifier?.type !== "Identifier") return null;
  return bindingForIdentifier(identifier, analysis);
}

function resourceCreationKind(value: unknown, analysis: BindingAnalysis): ResourceKind | null {
  const expression = unwrapChain(value);
  if (expression?.type === "NewExpression") {
    const callee = unwrapChain(expression.callee);
    if (callee !== null && isUnshadowedGlobal(callee, "Image", analysis)) return "image";
    if (callee !== null && isUnshadowedGlobal(callee, "XMLHttpRequest", analysis)) return "xhr";
  }
  if (expression?.type !== "CallExpression") return null;
  const callee = unwrapChain(expression.callee);
  if (callee?.type !== "MemberExpression" || memberProperty(callee) !== "createElement")
    return null;
  if (!isUnshadowedGlobal(callee.object, "document", analysis)) return null;
  const tag = staticString(
    Array.isArray(expression.arguments) ? expression.arguments[0] : null,
  )?.toLowerCase();
  if (tag === "img" || tag === "image") return "image";
  if (["audio", "video", "source", "track"].includes(tag ?? "")) return "media";
  return null;
}

function collectNetworkSinkBindingsToFixedPoint(
  program: AstNode,
  analysis: BindingAnalysis,
): Set<Variable> {
  const bindings = new Set<Variable>();
  const sourceHasNetworkSinkIdentity = (value: unknown): boolean => {
    const expression = unwrapChain(value);
    if (expression === null) return false;
    if (
      ["fetch", "WebSocket", "EventSource"].some((name) =>
        isUnshadowedGlobal(expression, name, analysis),
      )
    ) {
      return true;
    }
    if (
      expression.type === "MemberExpression" &&
      memberProperty(expression) === "sendBeacon" &&
      isUnshadowedGlobal(expression.object, "navigator", analysis)
    ) {
      return true;
    }
    const sourceBinding = bindingForIdentifier(expression, analysis);
    return sourceBinding !== null && bindings.has(sourceBinding);
  };
  const collect = (current: AstNode): boolean => {
    let changed = false;
    if (current.type === "VariableDeclarator" || current.type === "AssignmentExpression") {
      const targetIdentifier = node(
        current.type === "VariableDeclarator" ? current.id : current.left,
      );
      const target =
        targetIdentifier?.type === "Identifier"
          ? bindingForIdentifier(targetIdentifier, analysis)
          : null;
      const source = current.type === "VariableDeclarator" ? current.init : current.right;
      if (target !== null && sourceHasNetworkSinkIdentity(source) && !bindings.has(target)) {
        bindings.add(target);
        changed = true;
      }
    }
    for (const child of childNodes(current)) changed = collect(child) || changed;
    return changed;
  };
  for (let pass = 0; pass <= analysis.originByBinding.size; pass += 1) {
    if (!collect(program)) return bindings;
  }
  throw new Error("network sink provenance fixed point did not converge");
}

function collectResourceBindingsToFixedPoint(
  program: AstNode,
  analysis: BindingAnalysis,
): Map<Variable, ResourceKind> {
  const bindings = new Map<Variable, ResourceKind>();
  const collect = (current: AstNode): boolean => {
    let changed = false;
    if (current.type === "VariableDeclarator" || current.type === "AssignmentExpression") {
      const target = resourceBindingForValue(
        current.type === "VariableDeclarator" ? current.id : current.left,
        analysis,
      );
      const source = current.type === "VariableDeclarator" ? current.init : current.right;
      const sourceBinding = resourceBindingForValue(source, analysis);
      const kind =
        resourceCreationKind(source, analysis) ??
        (sourceBinding === null ? null : (bindings.get(sourceBinding) ?? null));
      if (target !== null && kind !== null && !bindings.has(target)) {
        bindings.set(target, kind);
        changed = true;
      }
    }
    for (const child of childNodes(current)) changed = collect(child) || changed;
    return changed;
  };
  for (let pass = 0; pass <= analysis.originByBinding.size; pass += 1) {
    if (!collect(program)) return bindings;
  }
  throw new Error("resource provenance fixed point did not converge");
}

function createBindingAnalysis(program: AstNode): BindingAnalysis {
  const manager = analyze(program as never, {
    ecmaVersion: 2024,
    sourceType: "module",
    impliedStrict: true,
  });
  const bindingByIdentifier = new Map<AstNode, Variable>();
  const referenceByIdentifier = new Map<AstNode, Reference>();
  const originByBinding = new Map<Variable, Origin>();

  for (const scope of manager.scopes) {
    for (const variable of scope.variables) {
      originByBinding.set(variable, Provenance.Unknown);
      variable.identifiers.forEach((identifier) =>
        bindingByIdentifier.set(identifier as unknown as AstNode, variable),
      );
    }
    for (const reference of [...scope.references, ...scope.through]) {
      referenceByIdentifier.set(reference.identifier as unknown as AstNode, reference);
    }
  }
  return { bindingByIdentifier, referenceByIdentifier, originByBinding };
}

function identifierOrigin(identifier: AstNode, analysis: BindingAnalysis): Origin {
  const declaredBinding = analysis.bindingByIdentifier.get(identifier);
  if (declaredBinding !== undefined) {
    return analysis.originByBinding.get(declaredBinding) ?? Provenance.Unknown;
  }
  const reference = analysis.referenceByIdentifier.get(identifier);
  if (reference?.resolved !== null && reference?.resolved !== undefined) {
    return analysis.originByBinding.get(reference.resolved) ?? Provenance.Unknown;
  }
  const name = identifierName(identifier);
  if (name === "eval") return Provenance.Eval;
  if (name === "Function") return Provenance.Function;
  if (name === "globalThis") return Provenance.GlobalThis;
  return Provenance.Unknown;
}

function hasOrigin(origin: Origin, expected: Origin): boolean {
  return (origin & expected) !== 0;
}

function expressionOrigin(value: unknown, analysis: BindingAnalysis): Origin {
  const candidate = unwrapChain(value);
  if (candidate === null) return Provenance.Unknown;
  if (candidate.type === "Identifier") return identifierOrigin(candidate, analysis);
  if (candidate.type === "MemberExpression") {
    const objectOrigin = expressionOrigin(candidate.object, analysis);
    const property = memberProperty(candidate);
    if (hasOrigin(objectOrigin, Provenance.GlobalThis) && property === "eval") {
      return Provenance.Eval;
    }
    if (hasOrigin(objectOrigin, Provenance.GlobalThis) && property === "Function") {
      return Provenance.Function;
    }
  }
  return Provenance.Unknown;
}

function bindingForIdentifier(identifier: AstNode, analysis: BindingAnalysis): Variable | null {
  return (
    analysis.bindingByIdentifier.get(identifier) ??
    analysis.referenceByIdentifier.get(identifier)?.resolved ??
    null
  );
}

function setPatternOrigin(value: unknown, origin: Origin, analysis: BindingAnalysis): boolean {
  if (origin === Provenance.Unknown) return false;
  let changed = false;
  for (const identifier of patternIdentifiers(value)) {
    const binding = bindingForIdentifier(identifier, analysis);
    if (binding !== null) {
      const prior = analysis.originByBinding.get(binding) ?? Provenance.Unknown;
      const next = prior | origin;
      if (next !== prior) {
        analysis.originByBinding.set(binding, next);
        changed = true;
      }
    }
  }
  return changed;
}

function setDestructuredGlobalOrigins(value: AstNode, analysis: BindingAnalysis): boolean {
  if (value.type !== "ObjectPattern" || !Array.isArray(value.properties)) return false;
  let changed = false;
  for (const propertyValue of value.properties) {
    const property = node(propertyValue);
    if (property?.type !== "Property") continue;
    const sourceName =
      property.computed === true ? staticString(property.key) : identifierName(property.key);
    if (sourceName === "eval") {
      changed = setPatternOrigin(property.value, Provenance.Eval, analysis) || changed;
    }
    if (sourceName === "Function") {
      changed = setPatternOrigin(property.value, Provenance.Function, analysis) || changed;
    }
  }
  return changed;
}

function collectProvenance(current: AstNode, analysis: BindingAnalysis): boolean {
  let changed = false;
  if (current.type === "VariableDeclarator") {
    const id = node(current.id);
    const init = node(current.init);
    if (id !== null) {
      const sourceOrigin = expressionOrigin(init, analysis);
      changed =
        id.type === "ObjectPattern" && hasOrigin(sourceOrigin, Provenance.GlobalThis)
          ? setDestructuredGlobalOrigins(id, analysis) || changed
          : setPatternOrigin(id, sourceOrigin, analysis) || changed;
    }
  }

  if (current.type === "AssignmentExpression") {
    const left = node(current.left);
    const right = node(current.right);
    if (left !== null) {
      const sourceOrigin = expressionOrigin(right, analysis);
      changed =
        left.type === "ObjectPattern" && hasOrigin(sourceOrigin, Provenance.GlobalThis)
          ? setDestructuredGlobalOrigins(left, analysis) || changed
          : setPatternOrigin(left, sourceOrigin, analysis) || changed;
    }
  }

  for (const child of childNodes(current)) {
    changed = collectProvenance(child, analysis) || changed;
  }
  return changed;
}

function collectProvenanceToFixedPoint(program: AstNode, analysis: BindingAnalysis): void {
  const maximumPasses = analysis.originByBinding.size * 3 + 1;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    if (!collectProvenance(program, analysis)) return;
  }
  throw new Error("provenance fixed point did not converge");
}

function scriptBindingForValue(value: unknown, analysis: BindingAnalysis): Variable | null {
  const identifier = node(value);
  if (identifier?.type !== "Identifier") return null;
  return bindingForIdentifier(identifier, analysis);
}

function isScriptElementCreation(value: unknown, analysis: BindingAnalysis): boolean {
  const call = unwrapChain(value);
  if (call?.type !== "CallExpression") return false;
  const callee = unwrapChain(call.callee);
  if (callee?.type !== "MemberExpression" || memberProperty(callee) !== "createElement")
    return false;
  if (!isUnshadowedGlobal(callee.object, "document", analysis)) return false;
  return (
    staticString(Array.isArray(call.arguments) ? call.arguments[0] : null)?.toLowerCase() ===
    "script"
  );
}

function expressionHasScriptProvenance(
  value: unknown,
  analysis: BindingAnalysis,
  scriptBindings: Set<Variable>,
): boolean {
  if (isScriptElementCreation(value, analysis)) return true;
  const binding = scriptBindingForValue(unwrapChain(value), analysis);
  return binding !== null && scriptBindings.has(binding);
}

function collectScriptProvenance(
  current: AstNode,
  analysis: BindingAnalysis,
  scriptBindings: Set<Variable>,
): boolean {
  let changed = false;
  if (current.type === "VariableDeclarator") {
    const binding = scriptBindingForValue(current.id, analysis);
    if (
      binding !== null &&
      expressionHasScriptProvenance(current.init, analysis, scriptBindings) &&
      !scriptBindings.has(binding)
    ) {
      scriptBindings.add(binding);
      changed = true;
    }
  }
  if (current.type === "AssignmentExpression") {
    const binding = scriptBindingForValue(current.left, analysis);
    if (
      binding !== null &&
      expressionHasScriptProvenance(current.right, analysis, scriptBindings) &&
      !scriptBindings.has(binding)
    ) {
      scriptBindings.add(binding);
      changed = true;
    }
  }
  for (const child of childNodes(current)) {
    changed = collectScriptProvenance(child, analysis, scriptBindings) || changed;
  }
  return changed;
}

function collectScriptProvenanceToFixedPoint(
  program: AstNode,
  analysis: BindingAnalysis,
): Set<Variable> {
  const scriptBindings = new Set<Variable>();
  const maximumPasses = analysis.originByBinding.size + 1;
  for (let pass = 0; pass < maximumPasses; pass += 1) {
    if (!collectScriptProvenance(program, analysis, scriptBindings)) return scriptBindings;
  }
  throw new Error("script provenance fixed point did not converge");
}

function objectPatternHasDynamicComputedKey(value: AstNode): boolean {
  if (value.type !== "ObjectPattern" || !Array.isArray(value.properties)) return false;
  return value.properties.some((propertyValue) => {
    const property = node(propertyValue);
    return (
      property?.type === "Property" &&
      property.computed === true &&
      staticString(property.key) === null
    );
  });
}

function scanJavaScriptNode(
  current: AstNode,
  analysis: BindingAnalysis,
  file: string,
  root: string,
  allowAuditedProtobufRegistry: boolean,
  violations: Set<string>,
  references: ExecutableReference[],
  scriptBindings: Set<Variable>,
  resourceBindings: Map<Variable, ResourceKind>,
  networkSinkBindings: Set<Variable>,
): void {
  if (current.type === "Identifier") {
    const origin = identifierOrigin(current, analysis);
    if (hasOrigin(origin, Provenance.Eval)) violations.add("eval-reference");
    if (hasOrigin(origin, Provenance.Function)) violations.add("function-reference");
  }

  if (current.type === "MemberExpression") {
    const origin = expressionOrigin(current, analysis);
    if (hasOrigin(origin, Provenance.Eval)) violations.add("eval-reference");
    if (hasOrigin(origin, Provenance.Function)) violations.add("function-reference");
    if (
      hasOrigin(expressionOrigin(current.object, analysis), Provenance.GlobalThis) &&
      current.computed === true &&
      memberProperty(current) === null &&
      !(allowAuditedProtobufRegistry && isAuditedProtobufRegistryAccess(current, analysis))
    ) {
      violations.add("computed-global-dynamic-code-access");
    }
  }

  if (current.type === "VariableDeclarator") {
    const id = node(current.id);
    if (
      id !== null &&
      objectPatternHasDynamicComputedKey(id) &&
      hasOrigin(expressionOrigin(current.init, analysis), Provenance.GlobalThis)
    ) {
      violations.add("computed-global-dynamic-code-access");
    }
  }

  if (current.type === "AssignmentExpression") {
    const left = node(current.left);
    if (
      left !== null &&
      objectPatternHasDynamicComputedKey(left) &&
      hasOrigin(expressionOrigin(current.right, analysis), Provenance.GlobalThis)
    ) {
      violations.add("computed-global-dynamic-code-access");
    }
    if (left?.type === "MemberExpression" && memberProperty(left) === "src") {
      const binding = scriptBindingForValue(left.object, analysis);
      if (binding !== null && scriptBindings.has(binding)) {
        executableUrlArgument(current.right, file, root, references, violations);
      }
      if (binding !== null && resourceBindings.has(binding)) {
        networkUrlArgument(current.right, violations);
      }
    }
  }

  if (current.type === "CallExpression" || current.type === "NewExpression") {
    const callee = unwrapChain(current.callee);
    if (callee !== null && isAuditedProtobufRegistryAccess(callee, analysis))
      violations.add("computed-global-dynamic-code-access");
    const argumentsList = Array.isArray(current.arguments) ? current.arguments : [];
    const calleeBinding = callee === null ? null : bindingForIdentifier(callee, analysis);
    if (
      callee !== null &&
      (isUnshadowedGlobal(callee, "fetch", analysis) ||
        (calleeBinding !== null && networkSinkBindings.has(calleeBinding)))
    ) {
      networkUrlArgument(argumentsList[0], violations);
    }
    if (
      current.type === "NewExpression" &&
      callee !== null &&
      (isUnshadowedGlobal(callee, "WebSocket", analysis) ||
        isUnshadowedGlobal(callee, "EventSource", analysis))
    ) {
      networkUrlArgument(argumentsList[0], violations);
    }
    if (callee !== null && isUnshadowedGlobal(callee, "importScripts", analysis)) {
      if (argumentsList.length === 0) violations.add("computed-executable-url");
      argumentsList.forEach((argument) =>
        executableUrlArgument(argument, file, root, references, violations),
      );
    }
    if (
      current.type === "NewExpression" &&
      callee !== null &&
      (isUnshadowedGlobal(callee, "Worker", analysis) ||
        isUnshadowedGlobal(callee, "SharedWorker", analysis))
    ) {
      executableUrlArgument(argumentsList[0], file, root, references, violations);
    }
    if (callee?.type === "MemberExpression" && memberProperty(callee) === "register") {
      const serviceWorker = unwrapChain(callee.object);
      const navigatorMember = serviceWorker?.type === "MemberExpression" ? serviceWorker : null;
      if (
        navigatorMember !== null &&
        memberProperty(navigatorMember) === "serviceWorker" &&
        isUnshadowedGlobal(navigatorMember.object, "navigator", analysis)
      ) {
        executableUrlArgument(argumentsList[0], file, root, references, violations);
      }
    }
    if (callee?.type === "MemberExpression" && memberProperty(callee) === "sendBeacon") {
      if (isUnshadowedGlobal(callee.object, "navigator", analysis)) {
        networkUrlArgument(argumentsList[0], violations);
      }
    }
    if (callee?.type === "MemberExpression" && memberProperty(callee) === "open") {
      const binding = resourceBindingForValue(callee.object, analysis);
      if (binding !== null && resourceBindings.get(binding) === "xhr") {
        networkUrlArgument(argumentsList[1], violations);
      }
    }
    if (callee?.type === "MemberExpression" && memberProperty(callee) === "setAttribute") {
      const binding = scriptBindingForValue(callee.object, analysis);
      if (
        binding !== null &&
        scriptBindings.has(binding) &&
        staticString(argumentsList[0])?.toLowerCase() === "src"
      ) {
        executableUrlArgument(argumentsList[1], file, root, references, violations);
      }
      if (
        binding !== null &&
        resourceBindings.has(binding) &&
        staticString(argumentsList[0])?.toLowerCase() === "src"
      ) {
        networkUrlArgument(argumentsList[1], violations);
      }
    }
  }

  if (
    current.type === "ImportDeclaration" ||
    current.type === "ExportNamedDeclaration" ||
    current.type === "ExportAllDeclaration"
  ) {
    if (current.source !== null && current.source !== undefined) {
      const rule = moduleSpecifierRule(current.source, file, root, false);
      if (rule !== null) violations.add(rule);
      const specifier = staticString(current.source);
      if (
        rule === null &&
        specifier !== null &&
        (specifier.startsWith(".") || specifier.startsWith("/"))
      ) {
        localExecutableReference(specifier, file, root, "javascript", references, violations);
      }
    }
  }
  if (current.type === "ImportExpression") {
    const source = node(current.source);
    const callee = source?.type === "CallExpression" ? node(source.callee) : null;
    const calleeObject = callee?.type === "MemberExpression" ? node(callee.object) : null;
    const runtimeObject =
      calleeObject?.type === "MemberExpression" ? node(calleeObject.object) : null;
    const runtimeGetUrl =
      source?.type === "CallExpression" &&
      callee?.type === "MemberExpression" &&
      memberProperty(callee) === "getURL" &&
      calleeObject?.type === "MemberExpression" &&
      memberProperty(calleeObject) === "runtime" &&
      runtimeObject?.type === "Identifier" &&
      identifierName(runtimeObject) === "chrome" &&
      Array.isArray(source.arguments) &&
      source.arguments.length === 1
        ? staticString(source.arguments[0])
        : null;
    if (
      runtimeGetUrl !== null &&
      runtimeGetUrl.startsWith("assets/") &&
      !remoteUrl.test(runtimeGetUrl)
    ) {
      localExecutableReference(
        `/${runtimeGetUrl}`,
        file,
        root,
        "javascript",
        references,
        violations,
      );
    } else {
      const rule = moduleSpecifierRule(current.source, file, root, true);
      if (rule !== null) violations.add(rule);
      const specifier = staticString(current.source);
      if (specifier !== null && (specifier.startsWith(".") || specifier.startsWith("/"))) {
        localExecutableReference(specifier, file, root, "javascript", references, violations);
      }
    }
  }
  if (
    current.type === "Literal" &&
    typeof current.value === "string" &&
    /(?:^|[\s;])(?:unsafe-eval|wasm-unsafe-eval)(?:$|[\s;])/u.test(current.value)
  ) {
    violations.add("unsafe-csp-directive");
  }

  for (const child of childNodes(current)) {
    scanJavaScriptNode(
      child,
      analysis,
      file,
      root,
      allowAuditedProtobufRegistry,
      violations,
      references,
      scriptBindings,
      resourceBindings,
      networkSinkBindings,
    );
  }
}

function javascriptViolations(
  source: string,
  file: string,
  root: string,
  allowAuditedProtobufRegistry = false,
): { rules: string[]; references: ExecutableReference[] } {
  let program: AstNode;
  try {
    program = parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      ranges: true,
    }) as unknown as AstNode;
  } catch {
    return { rules: ["javascript-parse-error"], references: [] };
  }
  const violations = new Set<string>();
  const references: ExecutableReference[] = [];
  let analysis: BindingAnalysis;
  try {
    analysis = createBindingAnalysis(program);
    collectProvenanceToFixedPoint(program, analysis);
  } catch {
    return { rules: ["javascript-scope-error"], references: [] };
  }
  let scriptBindings: Set<Variable>;
  let resourceBindings: Map<Variable, ResourceKind>;
  let networkSinkBindings: Set<Variable>;
  try {
    scriptBindings = collectScriptProvenanceToFixedPoint(program, analysis);
    resourceBindings = collectResourceBindingsToFixedPoint(program, analysis);
    networkSinkBindings = collectNetworkSinkBindingsToFixedPoint(program, analysis);
  } catch {
    return { rules: ["javascript-scope-error"], references: [] };
  }
  scanJavaScriptNode(
    program,
    analysis,
    file,
    root,
    allowAuditedProtobufRegistry,
    violations,
    references,
    scriptBindings,
    resourceBindings,
    networkSinkBindings,
  );
  return { rules: [...violations], references };
}

function attributes(value: HtmlNode): Map<string, string> {
  return new Map(
    (value.attrs ?? []).map((attribute) => [attribute.name.toLowerCase(), attribute.value]),
  );
}

function scriptMimeEssence(type: string): string {
  return type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
}

function htmlAnalysis(
  source: string,
  file: string,
  root: string,
): { rules: string[]; references: ExecutableReference[] } {
  const violations = new Set<string>();
  const references: ExecutableReference[] = [];
  let document: HtmlNode;
  try {
    document = parseHtml(source);
  } catch {
    return { rules: ["html-parse-error"], references: [] };
  }

  const visit = (current: HtmlNode): void => {
    const tag = current.tagName?.toLowerCase();
    const attrs = attributes(current);
    if (tag === "script") {
      const type = scriptMimeEssence(attrs.get("type") ?? "");
      const executable = !nonExecutableScriptTypes.has(type);
      const content = (current.childNodes ?? [])
        .filter((child) => child.nodeName === "#text")
        .map((child) => child.value ?? "")
        .join("")
        .trim();
      if (executable && content.length > 0) violations.add("inline-script");
      const src = attrs.get("src");
      if (executable && src !== undefined && remoteUrl.test(src.trim())) {
        violations.add("remote-script-url");
      } else if (executable && src !== undefined) {
        localExecutableReference(src.trim(), file, root, "javascript", references, violations);
      }
    }
    if (tag === "link") {
      const rel = (attrs.get("rel") ?? "").toLowerCase().split(/\s+/u);
      const as = (attrs.get("as") ?? "").toLowerCase();
      const href = attrs.get("href")?.trim();
      const executableLink =
        rel.includes("modulepreload") ||
        rel.includes("stylesheet") ||
        (rel.includes("preload") && (as === "script" || as === "style"));
      if (executableLink && href !== undefined && remoteUrl.test(href)) {
        violations.add("remote-link-url");
      }
      if (
        href !== undefined &&
        remoteUrl.test(href) &&
        (rel.some((value) => ["icon", "preload", "prefetch", "manifest"].includes(value)) ||
          as === "image" ||
          as === "audio" ||
          as === "video" ||
          as === "font")
      ) {
        violations.add("remote-resource-url");
      }
    }
    if (["img", "audio", "video", "source", "track"].includes(tag ?? "")) {
      const src = attrs.get("src")?.trim();
      if (src !== undefined && remoteUrl.test(src)) violations.add("remote-resource-url");
    }
    if (
      tag === "meta" &&
      (attrs.get("http-equiv") ?? "").toLowerCase() === "content-security-policy"
    ) {
      const content = attrs.get("content") ?? "";
      if (/['"]?(?:unsafe-eval|wasm-unsafe-eval)['"]?/u.test(content)) {
        violations.add("unsafe-csp-directive");
      }
    }
    current.childNodes?.forEach(visit);
  };
  visit(document);
  return { rules: [...violations], references };
}

/**
 * The one chunk allowed to reach the protobuf text-encoding registry through a computed
 * `globalThis[...]`, found in the artifact itself rather than taken on trust from a file
 * beside it: exactly one chunk may carry that module, and it must be the Google-migration
 * worker entry. Two such chunks, or the marker in anything else, leaves the allowance unused
 * and the access is reported like any other.
 */
async function auditedProtobufWorker(files: readonly string[]): Promise<string | null> {
  const carriers: string[] = [];
  for (const file of files) {
    if (extname(file).toLowerCase() !== ".js") continue;
    const source = await readFile(file, "utf8").catch(() => "");
    if (source.includes(AUDITED_PROTOBUF_REGISTRY)) carriers.push(file);
  }
  const only = carriers.length === 1 ? carriers[0] : undefined;
  if (only === undefined) return null;
  return /^google-migration-worker-entry-[A-Za-z\d_-]+\.js$/u.test(basename(only)) ? only : null;
}

export async function findExecutablePolicyViolations(
  directory: string,
  executableReferences: readonly ExecutableReference[] = [],
): Promise<ExecutablePolicyViolation[]> {
  const rootMetadata = await lstat(directory);
  if (rootMetadata.isSymbolicLink() || !rootMetadata.isDirectory()) {
    throw new Error(`Executable policy root must be a real non-symlink directory: ${directory}`);
  }
  const discovered = await executableEntries(directory);
  const auditedWorker = await auditedProtobufWorker(discovered.files);
  const queue: ExecutableReference[] = [
    ...discovered.files.map((file) => ({
      file,
      type: extname(file).toLowerCase() === ".html" ? ("html" as const) : ("javascript" as const),
    })),
    ...executableReferences,
  ];
  const visited = new Set<string>();
  const violations: ExecutablePolicyViolation[] = discovered.violations.map((violation) => ({
    ...violation,
    file: relative(directory, violation.file),
  }));
  while (queue.length > 0) {
    const reference = queue.shift();
    if (reference === undefined) break;
    const key = `${resolve(reference.file)}:${reference.type}`;
    if (visited.has(key)) continue;
    visited.add(key);
    let source: string;
    try {
      const metadata = await lstat(reference.file);
      if (metadata.isSymbolicLink() || !metadata.isFile()) {
        violations.push({
          file: relative(directory, reference.file),
          rule: "nonregular-executable-entry",
        });
        continue;
      }
      source = await readFile(reference.file, "utf8");
    } catch {
      violations.push({
        file: relative(directory, reference.file),
        rule: "missing-executable-reference",
      });
      continue;
    }
    if (reference.type === "html") {
      const result = htmlAnalysis(source, reference.file, directory);
      violations.push(
        ...result.rules.map((rule) => ({
          file: relative(directory, reference.file),
          rule,
        })),
      );
      queue.push(...result.references);
    } else {
      const allowAudited = auditedWorker !== null && resolve(reference.file) === auditedWorker;
      const auditedLiteralCount = source.split(AUDITED_PROTOBUF_REGISTRY).length - 1;
      const auditedAccessCount = source.match(/globalThis\s*\[/gu)?.length ?? 0;
      const exactAuditedShape =
        allowAudited && auditedLiteralCount === 1 && auditedAccessCount === 3;
      if (allowAudited && !exactAuditedShape) {
        violations.push({
          file: relative(directory, reference.file),
          rule: "computed-global-dynamic-code-access",
        });
      }
      const result = javascriptViolations(source, reference.file, directory, exactAuditedShape);
      violations.push(
        ...result.rules.map((rule) => ({ file: relative(directory, reference.file), rule })),
      );
      queue.push(...result.references);
    }
  }
  return violations;
}
