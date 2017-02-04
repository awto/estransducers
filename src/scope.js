import * as Kit from "./kit"
import * as R from "ramda"
import {Tag,TypeInfo as TI,symbol,tok} from "./core"

export function assignSymbolsDecls(s) {
  const sa = Kit.toArray(s)
  s = Kit.auto(sa)
  function scope(root,par) {
    const vars = Object.create(par)
    const locs = new Map()
    const refs = new Map()
    root.ctx = {vars,locs,refs}
    for(const i of s.sub()) {
      if (i.enter) {
        switch(i.pos) {
        case Tag.body:
          block(i.value,vars)
          break
        case Tag.params:
          for(const j of s.sub()) {
            if (j.type === Tag.Identifier) {
              const {name} = j.value.node
              const sym = Symbol(name)
              const info = {sym,name,param:true,root,block:root,value:j.value}
              locs.set(sym,info)
              vars[name] = info 
            }
          }
          break
        }
      }
    }
    return locs
    function block(b,vars) {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.VariableDeclarator:
            for(const j of s.one()) {
              if (j.enter && j.type === Tag.Identifier) {
                const {name} = j.value.node
                const sym = j.value.sym = Symbol(name)
                const info = {sym,name,param:false,root,block:b,value:i.value}
                locs.set(sym,info)
                vars[name] = info
              }
            }
            break
          case Tag.BlockStatement:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.ForOfStatement:
          case Tag.Program:
            block(i.value,i.value.blockVars = Object.create(vars))
            break
          case Tag.FunctionExpression:
          case Tag.ArrowFunctionExpression:
          case Tag.FunctionDeclaration:
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
            const sub = scope(i.value,vars)
            for(const [s,i] of sub)
              locs.set(s,i)
            break
          case Tag.Identifier:
            const info = vars[i.value.node.name]
            if (info != null) {
              i.value.sym = info.sym
              refs.set(info.sym,info)
              if (info.root !== root) {
                (info.capt || (info.capt = new Set())).add(root)
              }
            }
          }
        }
      }
    }
  }
  const i = s.take()
  scope(i.value,{})
  return sa
}

function makeUniqStore() {
  let cur = 0
  return (like) => {
    const name = `uniq_id_${cur++}`, sym = Symbol(name)
    return {node:{name},typeInfo:TI.identifier,sym,like}
  }
}

export function uniq(s) {
  return s.first._uniqIdsStore || (s.first._uniqIdsStore = makeUniqStore())
}
