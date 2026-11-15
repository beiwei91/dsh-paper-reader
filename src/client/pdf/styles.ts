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
.pr-pages{position:relative;flex:1 1 auto;min-height:0;min-width:0;overflow:auto;padding:12px 0 48px;scroll-behavior:auto}
/* The page column is as wide as its widest page and at least as wide as the
   pane: centered while it fits, and a real horizontally scrollable row of pages
   (left edge reachable) once a zoomed page is wider than the pane. */
.pr-pages-inner{display:flex;flex-direction:column;align-items:center;gap:12px;min-width:100%;width:max-content;margin:0 auto}
.pr-page{position:relative;background:#fff;box-shadow:var(--dsw-shadow-lv1,0 1px 4px rgba(0,0,0,.16));border-radius:2px;overflow:hidden;flex:0 0 auto}
.pr-canvas{display:block}
.pr-text{position:absolute;inset:0;overflow:clip;line-height:1;letter-spacing:normal;word-spacing:normal;text-align:initial;-webkit-text-size-adjust:none;text-size-adjust:none;forced-color-adjust:none;transform-origin:0 0;color-scheme:only light;z-index:2;--min-font-size:1;--text-scale-factor:calc(var(--total-scale-factor) * var(--min-font-size));--min-font-size-inv:calc(1 / var(--min-font-size));--scale-round-x:1px;--scale-round-y:1px}
.pr-text :is(span,br){color:transparent;position:absolute;white-space:pre;cursor:text;transform-origin:0% 0%;user-select:text}
.pr-text>:not(.markedContent),.pr-text .markedContent span:not(.markedContent){z-index:1;--font-height:0;font-size:calc(var(--text-scale-factor) * var(--font-height));--scale-x:1;--rotate:0deg;transform:rotate(var(--rotate)) scaleX(var(--scale-x)) scale(var(--min-font-size-inv))}
.pr-text .markedContent{display:contents}
.pr-text ::selection{background:rgba(56,132,255,.32)}
.pr-text .pr-hit{box-shadow:inset 0 -2px 0 rgba(255,176,0,.9);border-radius:2px}
.pr-hl-layer{position:absolute;inset:0;pointer-events:none;z-index:1;overflow:hidden}
.pr-hl-rect{position:absolute;border-radius:2px;pointer-events:none;background:rgba(255,214,0,.35)}
.pr-hl-rect[data-color="green"]{background:rgba(56,200,120,.35)}
.pr-hl-rect[data-color="blue"]{background:rgba(80,150,255,.32)}
.pr-hl-rect[data-color="pink"]{background:rgba(255,120,180,.35)}
.pr-hl-rect[data-color="orange"]{background:rgba(255,160,40,.35)}
.pr-hl-rect[data-color="purple"]{background:rgba(168,120,255,.35)}
.pr-hl-rect[data-color="cyan"]{background:rgba(60,200,220,.35)}
.pr-hl-rect[data-color="red"]{background:rgba(240,80,80,.32)}
/* Underline: a 2 px stroke along each box's bottom edge, no fill. The dark accent
   shades are the same values as the note badges, so one colour reads the same in
   the page, in the margin dot and in the toolbar swatch. */
.pr-hl-line{position:absolute;height:2px;border-radius:1px;pointer-events:none;background:#3b7bd8}
.pr-hl-line[data-color="yellow"]{background:#c9a100}
.pr-hl-line[data-color="green"]{background:#27995a}
.pr-hl-line[data-color="blue"]{background:#3b7bd8}
.pr-hl-line[data-color="pink"]{background:#d4568c}
.pr-hl-line[data-color="orange"]{background:#d97a12}
.pr-hl-line[data-color="purple"]{background:#7c53d6}
.pr-hl-line[data-color="cyan"]{background:#1596a8}
.pr-hl-line[data-color="red"]{background:#c92b2b}
/* Text boxes: semi-transparent theme surface, content-sized, never wider than
   40% of the page. Only the box itself takes pointer events, so selecting page
   text everywhere else keeps working. */
.pr-tb-layer{position:absolute;inset:0;pointer-events:none;z-index:4;overflow:hidden}
.pr-tb{position:absolute;max-width:40%;padding:2px 5px;border-radius:5px;font-size:11px;line-height:1.4;white-space:pre-wrap;overflow-wrap:anywhere;background:var(--dsw-alias-bg-secondary,rgba(240,242,245,.92));background:color-mix(in srgb,var(--dsw-alias-bg-secondary,#f0f2f5) 88%,transparent);border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));color:var(--dsw-alias-label-primary,#1f2328);box-shadow:var(--dsw-shadow-lv1,0 1px 4px rgba(0,0,0,.14));pointer-events:auto;cursor:pointer}
.pr-tb:hover,.pr-tb:focus-visible{background:color-mix(in srgb,var(--dsw-alias-bg-secondary,#f0f2f5) 96%,transparent);border-color:var(--dsw-alias-border-primary,rgba(0,0,0,.32))}
/* Note badges ride above the text layer (so they are clickable) but keep the
   layer itself transparent to the pointer: only the dots take events. */
.pr-badge-layer{position:absolute;inset:0;pointer-events:none;z-index:3;overflow:hidden}
.pr-hl-badge{position:absolute;width:9px;height:9px;margin:0;padding:0;appearance:none;-webkit-appearance:none;border:1px solid var(--dsw-alias-bg-primary,#fff);border-radius:50%;background:var(--dsw-alias-label-tertiary,#8b949e);box-shadow:0 0 0 1px var(--dsw-alias-border-secondary,rgba(0,0,0,.12));pointer-events:auto;cursor:pointer;opacity:.75;transition:opacity .12s ease,transform .12s ease}
.pr-hl-badge:hover,.pr-hl-badge:focus-visible{opacity:1;transform:scale(1.2)}
.pr-hl-badge[data-color="yellow"]{background:#c9a100}
.pr-hl-badge[data-color="green"]{background:#27995a}
.pr-hl-badge[data-color="blue"]{background:#3b7bd8}
.pr-hl-badge[data-color="pink"]{background:#d4568c}
.pr-hl-badge[data-color="orange"]{background:#d97a12}
.pr-hl-badge[data-color="purple"]{background:#7c53d6}
.pr-hl-badge[data-color="cyan"]{background:#1596a8}
.pr-hl-badge[data-color="red"]{background:#c92b2b}
.pr-sel{position:fixed;z-index:60;display:flex;align-items:center;gap:2px;padding:3px 4px;border-radius:8px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(0,0,0,.2));transform:translate(-50%,-100%)}
/* Eight colours fit the popover as a 4×2 palette instead of one long row. */
.pr-swatches{display:grid;grid-template-columns:repeat(4,13px);gap:3px;align-items:center}
.pr-swatch{width:13px;height:13px;border-radius:50%;border:1px solid rgba(0,0,0,.25);cursor:pointer;padding:0}
.pr-swatch[data-color="yellow"]{background:#ffd400}
.pr-swatch[data-color="green"]{background:#3cc878}
.pr-swatch[data-color="blue"]{background:#5b9dff}
.pr-swatch[data-color="pink"]{background:#ff7ab4}
.pr-swatch[data-color="orange"]{background:#ff9f2e}
.pr-swatch[data-color="purple"]{background:#a07aff}
.pr-swatch[data-color="cyan"]{background:#2fc8dc}
.pr-swatch[data-color="red"]{background:#f04646}
.pr-swatch[aria-pressed="true"]{outline:2px solid var(--dsw-alias-label-primary,#1f2328);outline-offset:1px}
/* The underline tool's colour row: a compact strip under the toolbar. */
.pr-bar.pr-color-bar{gap:3px;padding:3px 6px}
.pr-color-bar .pr-swatch{width:12px;height:12px}
.pr-tool-label{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);padding:0 2px}
.pr-note{position:fixed;z-index:61;width:232px;padding:6px;border-radius:8px;background:var(--dsw-alias-bg-elevated,#fff);box-shadow:var(--dsw-shadow-lv2,0 8px 24px rgba(0,0,0,.2));display:flex;flex-direction:column;gap:4px}
.pr-note-label{font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#57606a);padding:0 2px 1px}
.pr-note-input{width:100%;height:64px;resize:vertical;border:1px solid var(--dsw-alias-border-primary,rgba(0,0,0,.16));border-radius:6px;padding:4px 6px;font:inherit;font-size:12px;background:var(--dsw-alias-bg-primary,#fff);color:inherit;outline:none}
.pr-note-actions{display:flex;gap:4px;justify-content:flex-end}
.pr-status{padding:20px 12px;font-size:12px;line-height:1.6;text-align:center;color:var(--dsw-alias-label-secondary,#57606a)}
.pr-num{font-size:11px;color:var(--dsw-alias-label-secondary,#57606a);font-variant-numeric:tabular-nums;padding:0 4px}
.pr-toast{max-width:46%;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#57606a);padding:0 4px}
.pr-ocr{font-size:10px;color:var(--dsw-alias-label-tertiary,#8b949e);font-variant-numeric:tabular-nums;padding:0 4px;white-space:nowrap}
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
.pr-warn{font-size:11px;line-height:1.5;color:var(--dsw-alias-label-warning,#9a6700);max-width:420px;word-break:break-word;padding:0 6px}
.pr-results{width:100%;max-width:420px;max-height:38vh;overflow:auto;display:flex;flex-direction:column;gap:2px;border:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08));border-radius:8px;padding:4px}
.pr-result{display:flex;flex-direction:column;gap:2px;width:100%;text-align:left;border:0;background:transparent;font:inherit;color:inherit;padding:5px 7px;border-radius:6px;cursor:pointer}
.pr-result:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06))}
.pr-result-title{font-size:12px;line-height:1.4;color:var(--dsw-alias-label-primary,#1f2328);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical}
.pr-result-meta{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e)}
.pr-drop{border:1px dashed var(--dsw-alias-border-primary,rgba(0,0,0,.2));border-radius:10px;padding:16px;max-width:420px;width:100%}
.pr-drop[data-active="true"]{border-color:var(--dsw-focus-ring-color,#3b82f6);background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.04))}
.pr-head{flex:0 0 auto;display:flex;align-items:center;gap:6px;padding:5px 6px;border-bottom:1px solid var(--dsw-alias-border-secondary,rgba(0,0,0,.08))}
.pr-name{flex:1 1 auto;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:var(--dsw-alias-label-secondary,#57606a)}
/* Recently opened papers: a compact list under the open forms. */
.pr-recent{width:100%;max-width:420px;max-height:40vh;overflow-y:auto;display:flex;flex-direction:column;gap:1px;text-align:left}
.pr-recent-title{font-size:11px;color:var(--dsw-alias-label-tertiary,#8b949e);padding:2px 6px}
.pr-recent-row{display:flex;align-items:center;gap:2px;border-radius:6px}
.pr-recent-row:hover{background:var(--dsw-alias-bg-hover,rgba(0,0,0,.06))}
.pr-recent-open{flex:1 1 auto;min-width:0;display:flex;align-items:center;border:0;background:transparent;font:inherit;font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary,#57606a);text-align:left;padding:3px 6px;border-radius:6px;cursor:pointer;overflow:hidden}
.pr-recent-row:hover .pr-recent-open{color:var(--dsw-alias-label-primary,#1f2328)}
.pr-recent-open:disabled{opacity:.5;cursor:default}
.pr-recent-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.pr-recent-x{flex:0 0 auto;width:18px;height:18px;padding:0;border:0;border-radius:4px;background:transparent;color:var(--dsw-alias-label-tertiary,#8b949e);font:inherit;font-size:13px;line-height:1;cursor:pointer;opacity:0;display:flex;align-items:center;justify-content:center}
.pr-recent-row:hover .pr-recent-x,.pr-recent-x:focus-visible{opacity:1}
.pr-recent-x:hover{color:var(--dsw-alias-label-primary,#1f2328);background:var(--dsw-alias-bg-secondary,rgba(0,0,0,.09))}
`
