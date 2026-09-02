import type { SVGProps } from "react";

export interface ShardPassMarkProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  title?: string;
}

export function ShardPassMark({ title, ...props }: ShardPassMarkProps) {
  const accessibleProps = title
    ? { "aria-label": title, role: "img" }
    : { "aria-hidden": true as const };

  return (
    <svg
      {...props}
      {...accessibleProps}
      viewBox="0 0 32 32"
      width="24"
      height="24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M4 2h24v28H4V2Zm5 5v4h9.75c1.8 0 3.25.9 3.25 2s-1.45 2-3.25 2h-5.5C9.25 15 7 17.35 7 20.5S9.25 26 13.25 26H23v-4h-9.75C11.45 22 10 21.1 10 20s1.45-2 3.25-2h5.5C22.75 18 25 15.65 25 12.5S22.75 7 18.75 7H9Z"
        clipRule="evenodd"
      />
    </svg>
  );
}
