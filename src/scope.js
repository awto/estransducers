import * as Kit from "./kit"
import * as R from "ramda"
import {Tag,TypeInfo as TI,symbol,tok,resetFieldInfo} from "./core"
import * as assert from "assert"

export const outOfScopeSym = Symbol.for("<out of scope>") 

export const assignSym = R.pipe(
  resetFieldInfo,
  function assignSym(si) {
    const sa = Kit.toArray(si)
    let s = Kit.auto(sa)
    const root = s.first.value
    function varScope(scope) {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.VariableDeclaration:
            if (i.value.node.kind === "var") {
              Kit.skip(s.peelTo(Tag.declarations))
              for(const j of s.sub()) {
                if (j.enter) {
                  assert.equal(s.cur().pos, Tag.id)
                  for(const k of s.one()) {
                    if (k.enter && k.type === Tag.Identifier)
                      scope.set(k.value.node.name,k.value)
                  }
                  if (s.curLev() != null)
                    varScope(scope)
                }
              }
              Kit.skip(s.leave())
            }
            break
          case Tag.ClassDeclaration:
          case Tag.FunctionDeclaration:
            const j = s.curLev()
            if (j != null) {
              assert.equal(j.pos,Tag.id)
              scope.set(j.value.node.name,j.value)
            } 
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
          case Tag.FunctionExpression:
          case Tag.ArrowFunctionExpression:
            varScope(i.value.varScope = new Map())
            break
          }
        }
      }
    }
    varScope(root.varScope = new Map())
    let syms = root.syms = new Map()
    function addVarScope(scope,i) {
      for(const [j,jv] of i.value.varScope)
        scope.set(j,jv.sym || (jv.sym = Symbol(j)))
      return scope
    }
    s = Kit.auto(sa)
    function decls(scope,kind = "var") {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.Identifier:
            const fi = i.value.fieldInfo
            if (fi.declVar) {
              i.value.decl = true
              i.value.declKind = kind
              let {node:{name},nameLike:like,sym} = i.value
              if (kind === "var") {
                assert.ok(sym)
              } else {
                sym = sym || (i.value.sym = Symbol(name))
                scope.set(name,sym)
              }
              syms.set(sym,{name:like === "$$$" ? null : like || name,
                            num:syms.size,
                            sym,
                            rename:like != null})
            } else {
              i.value.decl = false
              const {name} = i.value.node
              if (i.value.sym == null) {
                let s = scope.get(name)
                if (s == null) {
                  s = Symbol(name)
                  scope.set(name,s)
                }
                i.value.sym = scope.get(i.value.node.name) || outOfScopeSym
              }
            }
            break
          case Tag.VariableDeclaration:
            decls(scope,i.value.node.kind)
            break
          case Tag.BlockStatement:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.ForOfStatement:
            decls(new Map(scope))
            break
          case Tag.FunctionDeclaration:
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
          case Tag.FunctionExpression:
          case Tag.ArrowFunctionExpression:
            const next = new Map(scope)
            decls(addVarScope(new Map(scope),i))
            break
          }
        }
      }
    }
    decls(addVarScope(new Map(),s.first))
    return sa
  })

/** Returns list of syms declared in the tokens */
export function queryLocalNames(s) {
  const res = new Set()
  for(const i of s)
    if (i.enter && i.type === Tag.Identifier && i.value.decl) {
      res.add(i.value.node.name)
  }
  return res
}

export function calcDecls(si) {
  const sa = Kit.toArray(si)
  const s = Kit.auto(sa)
  function scope(value,rootDecls) {
    function block(value,decls,refs) {
      let locref = false
      function walk(kind) {
        for(const i of s.sub()) {
          if (i.enter) {
            switch(i.type) {  
            case Tag.VariableDeclaration:
              walk(i.value.node.kind)
              break
            case Tag.FunctionDeclaration:
            case Tag.ObjectMethod:
            case Tag.ClassMethod:
              const j = s.curLev()
              if (j && j.pos === Tag.id) {
                rootDecls.add(j.value.sym)
                Kit.skip(s.one())
              }
              scope(i.value,new Set()).forEach(refs.add,refs)
              break
            case Tag.ArrowFunctionExpression:
            case Tag.FunctionExpression:
              const nroot = new Set()
              const k = s.curLev()
              if (k && k.pos === Tag.id) {
                nroot.add(k.value.sym)
                Kit.skip(s.one())
              }
              scope(i.value,nroot).forEach(refs.add,refs)
              break
            case Tag.ForStatement:
            case Tag.ForInStatement:
            case Tag.ForOfStatement:
            case Tag.Program:
            case Tag.BlockStatement:
              const nrefs = new Set()
              block(i.value,new Set(),nrefs).forEach(refs.add,refs)
              break
            case Tag.Identifier:
              if (i.value.decl != null && i.value.sym !== outOfScopeSym) {
                if (i.value.decl)
                  (kind === "var" ? rootDecls : decls).add(i.value.sym)
              }
              refs.add(i.value.sym)
              break
            }
          }
        }
      }
      walk()
      if (!locref)
        value.varRefs = refs
      return [...refs].filter(j => !decls.has(j))
    }
    return block(value,rootDecls,rootDecls)
  }
  scope(s.first.value,s.first.varRefs = new Set())
  return sa
}

const nameOpts = ["a","b","c","d","e","f","g","h","k","m","n","x","y","z"]

/** 
 * after adding some names, there may be some naming conflicts
 * this pass resolves them by looking for same name but different symbols ids
 * and renaming them accordingly
 */
export function* solve(si) {
  const sa = Kit.toArray(si)
  const root = sa[0].value
  const {syms} = root
  const constrs = new Map() //: Map<String,{syms:Symbol[],names:Set<String>}[]>
  let renames = new Map() //: Map<Symbol,String>
  const anyPat //: Map<Symbol,[[SymbolInfo]]>
        = new Map([...syms.values()]
                  .filter(i => i.name == null)
                  .map(i => [i.sym,[]]))
  const refsFrames = [] //: [[SymbolInfo]]
  for(const i of sa) {
    if (i.enter && i.value.varRefs != null) {
      const refs = [...i.value.varRefs].map(syms.get,syms) //: [SymbolInfo]
      refsFrames.push(refs)
      for(const i of refs) {
        if (i.name == null) {
          anyPat.get(i.sym).push(...refs)
        }
      }
    }
  }
  for(const [s,is] of anyPat) {
    const ism = new Map()
    for(const i of is.map(i => i.name).filter(i => i != null))
      ism.set(i,(ism.get(i) || 0)+1)
    let mn, mv
    for(const i of nameOpts) {
      const c = ism.get(i)
      if (!c) {
        mv = i
        break
      }
      if (mn == null || mn < c) {
        mn = c
        mv = i 
      }
    }
    syms.get(s).name = mv
  }
  for(const i of syms.values()) {
    let fi = constrs.get(i.name)
    if (fi == null)
      constrs.set(i.name,fi = [])
    if (i.rename) {
      renames.set(i.sym,i.name)
    }
  }
  for(const refs of refsFrames) {
    const names = new Map() //: Map<String,[SymbolInfo]>
    for(const i of refs) {
      let sil = names.get(i.name)
      if (sil == null)
        names.set(i.name,sil = [])
      sil.push(i)
    }
    const namesSet = new Set()
    for(const [n,i] of names) {
      constrs.get(n).push({
        names:namesSet,
        syms:i.sort((a,b) => a.num - b.num).map(a => a.sym)
      })
      namesSet.add(n)
    }
  }
  const names = new Set(constrs.keys())
  for(const [i,n] of constrs) {
    if (n.find(j => j.syms.length > 1) === undefined)
      constrs.delete(i)
  }
  for(const [n,i] of constrs) {
    const syms = new Set()
    const maxlen = Math.max(...i.map(j => j.syms.length))
    const adj = []
    let curadj = 0
    for(let j = 0; j < maxlen; j++) {
      while(names.has(n+(j+curadj)))
        curadj++
      adj.push(curadj)
    }
    for(const {syms:js} of i) {
      js.forEach(syms.add,syms)
    }
    const skipNum = new Set()
    for(const j of syms) {
      let x = 0
      let curMax = 0
      for(const {syms:tup} of i)
        curMax = Math.max(curMax,tup.indexOf(j))
      if (curMax !== 0)
        renames.set(j,n+(curMax+adj[curMax]))
    }
  }
  for(const i of sa) {
    if (i.enter && i.type === Tag.Identifier && i.value.sym != null) {
      const name = renames.get(i.value.sym)
      if (name != null)
        i.value.node.name = name
    }
    yield i
  }
}

export function assignSymbolsDecls(s) {
  const sa = Kit.toArray(s)
  s = Kit.auto(sa)
  let num = 0
  function scope(root,par) {
    let locs,refs,vars
    let ctx = root.ctx
    if (ctx == null) {
      vars = Object.create(par)
      locs = new Map()
      refs = new Map()
      root.ctx = {vars,locs,refs}
    } else {
      vars = ctx.vars
      locs = ctx.locs
      refs = ctx.refs
    }
    const newLocs = new Map()
    for(const i of s.sub()) {
      if (i.enter) {
        switch(i.pos) {
        case Tag.body:
          block(i.value,vars)
          break
        case Tag.params:
          for(const j of s.sub()) {
            if (j.type === Tag.Identifier && j.value.sym == null)
              newDecl(j.value,root,vars,true)
          }
          break
        }
      }
    }
    return newLocs
    function newDecl(value,block,vars,param=false) {
      const {name} = value.node
      const sym = value.sym = Symbol(name)
      const info = {sym,name,param:false,root,
                    block,value:value,num:num++}
      locs.set(sym,info)
      newLocs.set(sym,info)
      vars[name] = info
    }
    function block(b,vars) {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.VariableDeclarator:
            for(const j of s.one()) {
              if (j.enter && j.type === Tag.Identifier && j.value.sym == null)
                newDecl(j.value,b,vars)
            }
            break
          case Tag.BlockStatement:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.ForOfStatement:
          case Tag.Program:
            block(i.value,i.value.blockVars = Object.create(vars))
            break
          case Tag.FunctionDeclaration:
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
          case Tag.FunctionExpression:
          case Tag.ArrowFunctionExpression:
            const sub = scope(i.value,vars)
            for(const [s,i] of sub) {
              locs.set(s,i)
              newLocs.set(s,i)
            }
            break
          case Tag.Identifier:
            if (i.value.sym == null) {
              switch(i.pos) {
              case Tag.local:
              case Tag.id:
                newDecl(i.value,b,vars)
                break
              default:
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
    }
  }
  const i = s.take()
  scope(i.value,{})
  return sa
}

