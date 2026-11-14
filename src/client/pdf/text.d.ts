/** esbuild's text loader turns the copied PDF.js worker into a string module. */
declare module '*.txt' {
  const source: string
  export default source
}
