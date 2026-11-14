/**
 * The platform loader hands the factory a `require` with `.async`, which is the
 * only supported way to pull a lazy chunk. build.mjs injects that binding into
 * the factory scope, so the module code sees it as a free function.
 */
declare const __dshRequireAsync: (specifier: string) => Promise<unknown>
