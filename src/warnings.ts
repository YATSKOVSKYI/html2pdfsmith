import type { RenderWarning } from "./types";

export class WarningSink {
  readonly warnings: RenderWarning[] = [];

  constructor(private readonly handler?: (warning: RenderWarning) => void) {}

  add(code: string, message: string): void {
    const warning = { code, message };
    this.warnings.push(warning);
    this.handler?.(warning);
  }
}
