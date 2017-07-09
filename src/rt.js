import * as Kit from "./kit"
import * as Scope from "./scope"
import * as R from "ramda"
import {produce,Tag,TypeInfo as TI,symbol,tok,resetFieldInfo} from "./core"
import * as assert from "assert"

export function* inlineRT(si) {
  const s = Kit.auto(si)
  const {rt} = s.first
  const buf = []
  const symsMap = {}
  function* getBody(si) {
    const s = Kit.auto(si)
    Kit.skip(s.till(i => i.pos === Tag.body && i.type === Tag.Array))
    yield* s.sub()
    Kit.skip(s)
  }
  for(const i of rt.syms)
    symsMap[i.orig] = i
  for(const i of rt.sources) {
    const p = R.pipe(Kit.parse,produce,Scope.prepare,getBody,Kit.toArray)(i)
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
  yield* s.till(i => i.pos === Tag.body && i.type === Tag.Array)
  while(s.cur().type === Tag.ImportDeclaration)
    yield* s.one()
  for(const i of buf)
    yield* i
  yield* s
}

const modules = {}

export function setModule(name, code) {
  modules[name] = code
}

export function* setRT(si) {
  const [h,s] = Kit.la(si)
  h.rt = {sources:Object.values(modules),
          syms:[]}
  yield* s
}
