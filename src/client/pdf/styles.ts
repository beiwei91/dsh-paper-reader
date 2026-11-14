/**
 * Styles for the reading surface, rendered as one inline <style> element by the
 * chunk. Only `--dsw-alias-*` / `--dsw-shadow-*` tokens carry colour, each with a
 * light fallback so a token rename cannot leave the panel unstyled.
 */
export const VIEWER_CSS = `
.pr-root{position:relative;display:flex;flex-direction:column;height:100%;min-height:0;color:var(--dsw-alias-label-primary,#1f2328)}
.pr-toolbar{flex:0 0 auto;display:flex;align-items:center;gap:2px;padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
.pr-btn{appearance:none;border:0;background:transparent;color:var(--dsw-alias-label-secondary,#57606a);border-radius:6px;padding:3px 6px;font:inherit;font-size:12px;line-height:1.5;cursor:pointer}
.pr-btn:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06));color:var(--dsw-alias-label-primary,#1f2328)}
.pr-btn[aria-pressed="true"]{background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.09));color:var(--dsw-alias-label-primary,#1f2328)}
.pr-spacer{flex:1 1 auto}
.pr-pages{position:relative;flex:1 1 auto;min-height:0;overflow:auto;padding:12px 0 48px;display:flex;flex-direction:column;align-items:center;gap:12px;scroll-behavior:auto}
.pr-page{position:relative;background:#fff;box-shadow:var(--dsw-shadow-lv1,0 1px 4px rgba(0,0,0,.16));border-radius:2px;overflow:hidden;flex:0 0 auto}
.pr-canvas{display:block}
.pr-text{position:absolute;inset:0;overflow:clip;line-height:1;letter-spacing:normal;word-spacing:normal;text-align:initial;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;color-scheme:only light;z-index:2;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size));--scale-round-x:1px;--scale-round-y:1px}
.pr-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text}
.pr-text>:not(.markedContent),.pr-text .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.pr-text .markedContent{display:contents}
.pr-text ::selection{background:rgba(56,132,255,.32)}
.pr-text .pr-hit{box-shadow:inset 0 -2px 0 rgba(255,176,0,.9);border-radius:2px}
.pr-hl{background:rgba(255,214,0,.35);border-radius:2px}
.pr-hl[data-color="green"]{background:rgba(56,200,120,.35)}
.pr-hl[data-color="blue"]{background:rgba(80,150,255,.32)}
.pr-hl[data-color="pink"]{background:rgba(255,120,180,.35)}
.pr-sel{position:fixed;z-index:60;display:flex;align-items:center;gap:2px;padding:3px 4px;border-radius:8px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(0,0,0,.2));transform:translate(-50%,-100%)}
.pr-swatch{width:13px;height:13px;border-radius:50%;border:1px solid rgba(0,0,0,.25);cursor:pointer;padding:0}
.pr-swatch[data-color="yellow"]{background:#ffd400}
.pr-swatch[data-color="green"]{background:#3cc878}
.pr-swatch[data-color="blue"]{background:#5b9dff}
.pr-swatch[data-color="pink"]{background:#ff7ab4}
.pr-note{position:fixed;z-index:61;width:232px;padding:6px;border-radius:8px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(0,0,0,.2));display:flex;flex-direction:column;gap:4px}
.pr-note-input{width:100%;height:64px;resize:vertical;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));border-radius:6px;padding:4px 6px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-primary,#fff);color:inherit;outline:none}
.pr-note-actions{display:flex;gap:4px;justify-content:flex-end}
.pr-status{padding:20px 12px;font-size:12px;line-height:1.6;text-align:center;color:var(--dsw-alias-label-secondary,#57606a)}
.pr-num{font-size:11px;color:var(--dsw-alias-label-secondary,#57606a);font-variant-numeric:tabular-nums;padding:0 4px}
.pr-bar{display:flex;align-items:center;gap:4px;padding:4px 6px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
.pr-input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));border-radius:6px;padding:3px 7px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-primary,#fff);color:inherit;outline:none}
.pr-input:focus{border-color:var(--dsw-focus-ring-color,#3b82f6)}
.pr-list{position:absolute;z-index:20;left:6px;right:6px;top:76px;max-height:60%;overflow:auto;border-radius:8px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(0,0,0,.18));padding:4px}
.pr-row{display:block;width:100%;text-align:left;border:0;background:transparent;font:inherit;font-size:12px;line-height:1.5;color:inherit;padding:4px 8px;border-radius:6px;cursor:pointer;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pr-row:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06))}
.pr-hint{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);padding:2px 8px 4px}
`

export const BODY_CSS = `
.pr-body{position:relative;display:flex;flex-direction:column;height:100%;min-height:0}
.pr-empty{flex:1 1 auto;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;padding:24px 18px;text-align:center}
.pr-empty-title{font-size:13px;font-weight:600;color:var(--dsw-alias-label-primary,#1f2328)}
.pr-empty-hint{font-size:12px;line-height:1.6;color:var(--dsw-alias-label-secondary,#57606a)}
.pr-empty-foot{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e)}
.pr-form{display:flex;gap:6px;width:100%;max-width:420px}
.pr-input{flex:1 1 auto;min-width:0;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));border-radius:6px;padding:3px 7px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-primary,#fff);color:inherit;outline:none}
.pr-input:focus{border-color:var(--dsw-focus-ring-color,#3b82f6)}
.pr-form .pr-input{flex:1 1 auto}
.pr-open-btn{border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.05));color:inherit;border-radius:6px;padding:3px 10px;font:inherit;font-size:12px;cursor:pointer}
.pr-open-btn:disabled{opacity:.5;cursor:default}
.pr-error{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-error,#cf222e);max-width:420px;word-break:break-all}
.pr-drop{border:1px dashed var(--dsw-alias-border-primary,rgba(0,0,0,.2));border-radius:10px;padding:16px;max-width:420px;width:100%}
.pr-drop[data-active="true"]{border-color:var(--dsw-focus-ring-color,#3b82f6);background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.04))}
.pr-head{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
.pr-name{flex:1 1 auto;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#57606a)}
`
