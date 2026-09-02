import{i as P,f as $}from"./detect-GJf8O2wT.js";import{f as A,s as L}from"./format-BF4VSr4S.js";import{l as F}from"./log-B-C8fiGH.js";const T="__shardpass_chip_host__";let p=null,d=null,b=null;const H=`
  :host {
    all: initial;
    --sp-bg: #131316;
    --sp-bg-hover: #1c1c20;
    --sp-border: #26262b;
    --sp-border-soft: #1d1d21;
    --sp-fg: #f4f4f5;
    --sp-muted: #a1a1aa;
    --sp-muted-dim: #71717a;
    --sp-accent: #ff4d2e;
    --sp-success: #4ade80;
    --sp-warning: #f59e0b;
  }
  .chip {
    position: fixed;
    z-index: 2147483647;
    font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
    letter-spacing: -0.005em;
    color: var(--sp-fg);
    background: var(--sp-bg);
    border: 1px solid var(--sp-border);
    border-radius: 2px;
    padding: 0;
    box-shadow: 0 12px 32px rgba(0,0,0,0.55);
    min-width: 248px;
    max-width: 340px;
    animation: in 160ms cubic-bezier(0.16, 1, 0.3, 1);
    -webkit-font-smoothing: antialiased;
  }
  @keyframes in {
    from { opacity: 0; transform: translateY(-2px); }
    to   { opacity: 1; transform: translateY(0); }
  }
  .header {
    display: flex; align-items: center; gap: 8px;
    padding: 8px 10px 7px 10px;
    border-bottom: 1px solid var(--sp-border-soft);
  }
  .badge {
    width: 18px; height: 18px;
    border-radius: 2px;
    background: var(--sp-accent);
    color: #fff;
    display: grid; place-items: center;
    font-size: 11px; font-weight: 700; line-height: 1;
    letter-spacing: -0.04em;
    flex-shrink: 0;
  }
  .header-title {
    font-size: 12px; font-weight: 600; color: var(--sp-fg);
    letter-spacing: -0.015em;
    flex: 1; min-width: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .count {
    font-family: "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
    font-size: 9.5px; font-weight: 500;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--sp-muted);
  }
  .closebtn {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    color: var(--sp-muted-dim);
    width: 18px; height: 18px;
    display: grid; place-items: center;
    font-size: 14px; line-height: 1;
    border-radius: 2px;
    transition: background 100ms ease, color 100ms ease;
  }
  .closebtn:hover { color: var(--sp-fg); background: var(--sp-bg-hover); }

  .row {
    appearance: none; border: 0; background: transparent; cursor: pointer;
    width: 100%;
    display: flex; align-items: center; gap: 10px;
    padding: 8px 10px;
    color: inherit;
    text-align: left;
    transition: background 100ms ease;
    font-family: inherit;
    letter-spacing: -0.005em;
    border-bottom: 1px solid var(--sp-border-soft);
    position: relative;
  }
  .row:last-child { border-bottom: 0; }
  .row:hover { background: var(--sp-bg-hover); }
  .row:hover::before, .row:focus-visible::before {
    content: ""; position: absolute; left: 0; top: 0; bottom: 0; width: 2px;
    background: var(--sp-accent);
  }
  .row:focus-visible { outline: none; background: var(--sp-bg-hover); }

  .row-dot {
    width: 8px; height: 8px;
    border-radius: 1px;
    flex-shrink: 0;
    background: #e4e4e7;
  }
  .row-meta { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 2px; }
  .row-title {
    font-size: 12.5px; font-weight: 600; color: var(--sp-fg);
    letter-spacing: -0.015em;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-sub {
    font-family: "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
    font-size: 10px; color: var(--sp-muted);
    letter-spacing: 0;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
  }
  .row-code {
    font-family: "IBM Plex Mono", "SF Mono", ui-monospace, monospace;
    font-size: 13px; font-weight: 500;
    letter-spacing: 0.04em;
    color: var(--sp-fg);
    font-variant-numeric: tabular-nums;
    flex-shrink: 0;
  }
  .row-code.urgent { color: var(--sp-accent); }
  .row-timer {
    width: 10px; height: 10px;
    flex-shrink: 0;
    border-radius: 50%;
    position: relative;
  }
  .row-timer::after {
    content: ""; position: absolute; inset: 2px;
    background: var(--sp-bg);
    border-radius: 50%;
  }

  .single-row { padding: 10px 12px; border-bottom: 0; }
  .single-row .row-code { font-size: 15px; }

  .list { max-height: 260px; overflow-y: auto; }
  .list::-webkit-scrollbar { width: 4px; }
  .list::-webkit-scrollbar-thumb { background: var(--sp-border); border-radius: 0; }
  .list::-webkit-scrollbar-track { background: transparent; }

  .locked-state {
    padding: 10px 12px;
    font-size: 11.5px;
    line-height: 1.5;
    color: var(--sp-warning);
    border-left: 2px solid var(--sp-warning);
  }

`;function y(e){if(b=e,!p){p=document.createElement("div"),p.id=T,document.documentElement.appendChild(p),d=p.attachShadow({mode:"open"});const t=document.createElement("style");t.textContent=H,d.appendChild(t)}q(),g(e.anchor)}function v(){p?.parentNode&&p.parentNode.removeChild(p),p=null,d=null,b=null}function z(e){!p||!b||g(e)}function I(e){const t=document.getElementById(T);if(!t||!e)return!1;if(e===t)return!0;const o=t.shadowRoot;return o?o.contains(e):!1}function g(e){if(!d)return;const t=d.querySelector(".chip");if(!t)return;const o=e.getBoundingClientRect(),n=t.offsetWidth||260,i=t.offsetHeight||60,c=window.innerWidth,s=window.innerHeight;let l=o.bottom+6,u=o.left;l+i>s-8&&(l=Math.max(8,o.top-i-6)),u+n>c-8&&(u=Math.max(8,c-n-8)),t.style.top=`${Math.round(l)}px`,t.style.left=`${Math.round(u)}px`}function x(e){const t=e.toLowerCase().split(".").filter(Boolean);return t.length>=2?t.slice(-2).join("."):e}const N=["#ff4d2e","#f59e0b","#4ade80","#22d3ee","#a78bfa","#f472b6","#facc15","#94a3b8"];function _(e,t){let o=0;for(let n=0;n<e.length;n++)o=o*31+e.charCodeAt(n)|0;return Math.abs(o)%t}function B(e,t){const o=e.period>0?Math.max(0,e.remainingSeconds)/e.period:0,n=Math.round(o*100),i=t?"var(--sp-accent)":"var(--sp-fg)",c=document.createElement("div");return c.className="row-timer",c.style.background=`conic-gradient(${i} ${n}%, var(--sp-border) ${n}%)`,c}function S(e,t,o,n){const i=e.type==="hotp",c=!i&&e.remainingSeconds<=5,s=document.createElement("button");s.type="button",s.className=n?"row single-row":"row",s.dataset.accountId=e.id,s.title=`Fill code for ${e.issuer||e.label||t}`;const l=document.createElement("div");l.className="row-dot";const u=e.issuer||e.label||e.id||"?";l.style.background=N[_(u,N.length)],s.appendChild(l);const m=document.createElement("div");m.className="row-meta";const h=document.createElement("div");if(h.className="row-title",h.textContent=e.issuer||e.label||"Account",m.appendChild(h),e.label&&e.issuer){const a=document.createElement("div");a.className="row-sub",a.textContent=e.label,m.appendChild(a)}else if(!e.issuer&&!e.label){const a=document.createElement("div");a.className="row-sub",a.textContent=x(t),m.appendChild(a)}s.appendChild(m);const f=document.createElement("div");return f.className=c?"row-code urgent":"row-code",f.textContent=A(e.code),s.appendChild(f),i||s.appendChild(B(e,c)),s.addEventListener("mousedown",a=>a.preventDefault()),s.addEventListener("click",a=>{a.preventDefault(),a.stopPropagation(),o(e.code,e.id,e.type)}),s}function q(){if(!d||!b)return;const e=d.querySelector(".chip"),t=d.activeElement?.dataset?.accountId??null,o=d.querySelector(".list")?.scrollTop??0;e?.remove();const n=b,i=document.createElement("div");i.className="chip",e&&(i.style.animation="none");const c=()=>{const a=i.querySelector(".list");a&&o&&(a.scrollTop=o),t&&i.querySelector(`[data-account-id="${CSS.escape(t)}"]`)?.focus()};if(n.locked){const a=document.createElement("div");a.className="header";const w=document.createElement("div");w.className="badge",w.textContent="S",a.appendChild(w);const C=document.createElement("div");C.className="header-title",C.textContent="ShardPass is locked",a.appendChild(C);const O=E();a.appendChild(O),i.appendChild(a);const k=document.createElement("div");k.className="locked-state",k.textContent=`Open the extension to unlock (${x(n.domain)})`,i.appendChild(k),d.appendChild(i),g(n.anchor);return}if(n.accounts.length===0){v();return}if(n.accounts.length===1){const a=S(n.accounts[0],n.domain,n.onFill,!0);i.appendChild(a),i.appendChild(E({floating:!0})),d.appendChild(i),g(n.anchor),c();return}const s=document.createElement("div");s.className="header";const l=document.createElement("div");l.className="badge",l.textContent=(n.accounts[0].issuer||x(n.domain))[0].toUpperCase(),s.appendChild(l);const u=document.createElement("div");u.className="header-title",u.textContent=`${n.accounts[0].issuer||x(n.domain)} accounts`,s.appendChild(u);const m=document.createElement("div");m.className="count",m.textContent=String(n.accounts.length),s.appendChild(m),s.appendChild(E()),i.appendChild(s);const h=document.createElement("div");h.className="divider",i.appendChild(h);const f=document.createElement("div");f.className="list";for(const a of n.accounts)f.appendChild(S(a,n.domain,n.onFill,!1));i.appendChild(f),d.appendChild(i),g(n.anchor),c()}function E(e={}){const t=document.createElement("button");return t.className="closebtn",t.textContent="×",t.title="Dismiss",e.floating&&(t.style.position="absolute",t.style.top="4px",t.style.right="4px"),t.addEventListener("mousedown",o=>o.preventDefault()),t.addEventListener("click",o=>{o.preventDefault(),o.stopPropagation(),v()}),t}const r={matches:[],locked:!0,lastFetched:0,activeInput:null};async function D(e=!1){const t=Date.now();if(!e&&t-r.lastFetched<1500){r.activeInput&&M();return}r.lastFetched=t;const o=await L({kind:"findForDomain",domain:location.hostname});o.ok&&(r.locked=o.data.locked,r.matches=o.data.matches,r.activeInput&&M())}function R(e){return JSON.stringify({name:e.name||void 0,id:e.id||void 0,type:e.type,autocomplete:e.getAttribute("autocomplete")||void 0,inputmode:e.getAttribute("inputmode")||void 0,maxLength:e.maxLength>0?e.maxLength:void 0,placeholder:e.getAttribute("placeholder")||void 0,ariaLabel:e.getAttribute("aria-label")||void 0})}function j(e){r.activeInput=e,F("content",`attach on ${location.hostname}:`,R(e)),D()}function W(e){r.activeInput===e&&(r.activeInput=null,F("content",`detach on ${location.hostname}`),v())}function Y(e,t,o){const n=r.activeInput;if(!n)return;const i=Object.getPrototypeOf(n),c=Object.getOwnPropertyDescriptor(i,"value")?.set;c?c.call(n,e):n.value=e,n.dispatchEvent(new Event("input",{bubbles:!0})),n.dispatchEvent(new Event("change",{bubbles:!0})),n.focus(),o==="hotp"&&t&&L({kind:"incrementHotpCounter",id:t})}function M(){const e=r.activeInput;if(!e||!document.contains(e)){v();return}if(r.locked){y({anchor:e,domain:location.hostname,locked:!0,accounts:[],onFill:()=>{}});return}if(r.matches.length===0){v();return}y({anchor:e,domain:location.hostname,locked:!1,accounts:r.matches,onFill:(t,o,n)=>Y(t,o,n)})}document.addEventListener("focusin",e=>{const t=e.target;t instanceof HTMLInputElement&&P(t)&&j(t)},!0);document.addEventListener("focusout",e=>{const t=e.target;if(!(t instanceof HTMLInputElement))return;const o=e.relatedTarget;window.setTimeout(()=>{const n=document.activeElement,i=o instanceof Node?o:null,c=n instanceof Node?n:null;I(i)||I(c)||document.activeElement!==t&&W(t)},200)},!0);const U=new MutationObserver(()=>{r.activeInput&&!document.contains(r.activeInput)&&(v(),r.activeInput=null)});U.observe(document.documentElement,{childList:!0,subtree:!0});window.addEventListener("resize",()=>{r.activeInput&&z(r.activeInput)});window.addEventListener("scroll",()=>{r.activeInput&&z(r.activeInput)},!0);window.setInterval(()=>{r.activeInput&&(!r.locked&&r.matches.length===0||D(!0))},1e3);$();
