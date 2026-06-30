export function resizeRenderer(ctx) {
  const canvas = ctx.renderer.domElement;
  const w = canvas.clientWidth || window.innerWidth;
  const h = canvas.clientHeight || window.innerHeight;
  ctx.renderer.setSize(w, h, false);
}
