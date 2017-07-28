import * as Kit from "./kit"
import * as Scope from "./scope"
import {produce,Tag,TypeInfo as TI,symbol,tok,resetFieldInfo} from "./core"
import * as assert from "assert"

export function* importRT(si) {
  const s = Kit.auto(si)
  const {rt} = s.first.value
  if ((!rt.importSyms || !rt.importSyms.length)
      && (!rt.importNs || !rt.importNs.length))
    return s
  const mods = new Map()
  for(const i of rt.importSyms) {
    if (i.importFrom) {
      let f = i.imports.get(i.importFrom)
      if (f == null)
        mods.set(i.importFrom, f = [])
      f.push(i)
    }
  }
  yield* Kit.fileBody(s)
  const commonjs = s.opts.module === "commonjs"
  for(const [mn, syms] of mods) {
    yield* s.templates(Tag.push,
                       commonjs
                       ? `const {$_} = require("${mn}")`
                       : `import {$_} from "${mn}"`)
    for(const sym of syms)
      yield s.tok(Tag.push, Tag.Identifier, {sym})
    yield* s.leave()
  }
  if (rt.importNs) {
    for(const sym of rt.importNs)
      yield* s.toks(Tag.push,
                    s.opts.modules === "commonjs"
                    ? `import * as $I from "${mn}"`
                    : `const $I = require("${mn}")`,
                    sym)
  }
  yield* s
}

const emptyArr = []

export function* inline(si) {
  const s = Kit.auto(si)
  const {rt} = s.first.value
  const syms = rt.inlineSyms || emptyArr
  const sources = rt.inlineSources
  if (!sources || !syms.sources) {
    yield* s
    return
  }
  const buf = []
  const symsMap = {}
  function* getBody(si) {
    const s = Kit.auto(si)
    Kit.skip(s.till(i => i.pos === Tag.body && i.type === Tag.Array))
    yield* s.sub()
    Kit.skip(s)
  }
  const transf = Kit.pipe(Kit.parse,produce,Scope.prepare,getBody,Kit.toArray)
  for(const i of syms)
    symsMap[i.orig] = i
  for(const i of sources) {
    const p = transf(i)
    buf.push(p)
    for(const i of p) {
      if (i.enter) {
        const {node} = i.value
        node.loc = node.start = node.end = null
        if (i.type === Tag.Identifier) {
          const sym = symsMap[node.name]
          if (sym)
            i.value.sym = sym
          else if (i.value.sym)
            i.value.sym.strict = false
        }
      }
    }
  }
  yield* Kit.fileBody(s)
  for(const i of buf)
    yield* i
  yield* s
}

const modules = {}

export function setModule(name, code) {
  modules[name] = code
}

export function* init(si) {
  const [h,s] = Kit.la(si)
  h.value.rt = {inlineSources:Object.values(modules),
                importSyms:[],
                importNs:[],
                inlineSyms:[]}
  yield* s
}
