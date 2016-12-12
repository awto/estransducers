import * as Kit from "./Kit"
import * as R from "ramda"
import {Tag,enter,leave,tok,makeTag} from "./core"
import * as assert from "assert"

export const Root = makeTag("MatchRoot","ctrl")
export const Placeholder = makeTag("MatchPlaceholder","ctrl")

export const commit = R.pipe(
  Array.from,
  function*(s) {
    const buf = []
    for(let i of s) {
      switch(i.type) {
      case Root:
        if (!i.value.v.match)
          continue
        i = i.value.s
          ? enter(i.pos,i.type,i.value.v)
          : leave(i.pos,i.type,i.value.v)
        break
      case Placeholder:
        if (!i.value.v.match)
          continue
      }
      yield i
    }
  })

export const inject = R.curry(function match(pat, si) {
  pat = Kit.toArray(Kit.toks(Tag.top,pat))
  const start = pat[0].type
  const plen = pat.length
  return R.pipe(
    function* match(si) {
      const s = Kit.lookahead(si)
      const activePos = []
      const activeTok = []
      const activePh = []
      assert.ok(plen > 1)
      let level = 0
      for(let i of s) {
        if (i.enter) {
          level++
        }
        let aplen = activePos.length
        for(let p = 0; p < aplen; ++p) {
          let x = activePos[p]
          const v = activeTok[p]
          const ph = activePh[p]
          if (x !== plen && x !== -1 && activePh[p] == null) {
            const j = pat[x++]
            if (x < plen && j.pos != i.pos && j.enter === i.enter) {
              activePos[p] = -1
              v.match = false
              continue
            }
            if (j.enter) {
              switch(j.type) {
              case Tag.ExpressionStatement:
                const k = pat[x]
                if (k.type === Tag.Identifier) {
                  let block = false
                  if (k.value.node.name[0] === "$") {
                    const ph = activePh[p]
                          = {v,level,name:k.value.node.name.substr(1)}
                    yield enter(i.pos,Placeholder,ph)
                    x++
                    assert.equal(pat[x].value,k.value)
                    x++
                    assert.equal(pat[x].value,j.value)
                    x++
                    activePos[p] = x
                    continue
                  }
                }
                break
              case Tag.Identifier:
                let block = false
                if (j.value.node.name[0] === "$") {
                  const ph = activePh[p]
                        = {v,level,name:j.value.node.name.substr(1)}
                  yield enter(i.pos,Placeholder,ph)
                  assert.equal(pat[x].value,j.value)
                  x++
                  activePos[p] = x
                  continue
                }
              }
            }
            if (j.type !== i.type) {
              activePos[p] = -1
              v.match = false
              continue
            }
            activePos[p] = x
          }
        }
        if (i.enter) {
          if (i.type === start) {
            const v = {match:null}
            yield tok(i.pos,Root,{s:true,v})
            activePos.push(1)
            activeTok.push(v)
          }
        }
        yield i
        if (i.leave) {
          let aplen = activePos.length
          for(let p = aplen - 1; p >= 0; --p) {
            let ph = activePh[p]
            if (ph != null) {
              if (ph.level === level) {
                yield leave(i.pos,Placeholder,ph)
                ph = activePh[p] = null
              }
            }
            if (ph == null) {
              let x = activePos[p]
              if (x === plen) {
                activePos[p] = -1
                const v = activeTok[p]
                v.match = true
                while(activePos[0] === -1) {
                  activePos.shift()
                  activePh.shift()
                  activeTok.shift()
                }
                yield tok(i.pos,Root,{s:false,v})
              }
            }
          }
          level--
        }
      }
    },
    commit
  )(si)
})
