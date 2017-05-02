import * as Kit from "./kit"
import * as R from "ramda"
import {Tag,TypeInfo as TI,symbol,tok,resetFieldInfo,symInfo} from "./core"
import * as assert from "assert"
import * as Trace from "./trace"

const globals = new Map()

let symNum = 0
let curSymId = 0

symInfo(Tag.ClassDeclaration).funDecl = true
symInfo(Tag.FunctionDeclaration).funDecl = true

// String -> Sym
export function newSym(name = "", strict = false) {
  return { name, orig: name, id: `${name}@${curSymId++}`, strict }
}

/**
 * resets symbol number and value decl field 
 * for new identifiers from transform passes,
 * the transform pass has to use sym field to identifier 
 * symbols in `Identifier` nodes
 */
export const resetSym = R.pipe(
  resetFieldInfo,
  function resetSym(si) {
    const sa = Kit.toArray(si)
    const s = Kit.auto(sa)
    function walk(blockScope) {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.Identifier:
            const {sym} = i.value
            if (sym != null) {
              if (i.value.decl == null) {
                const fi = i.value.fieldInfo
                i.value.decl = fi.declVar
              }
              if (sym.num == null)
                sym.num = symNum++
              if (sym.orig != null)
                sym.name = sym.orig
              if (i.value.node.name == null)
                i.value.node.name = sym.name
              if (i.value.decl)
                blockScope.add(sym)
            }
            break
          case Tag.BlockStatement:
          case Tag.CatchClause:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.Program:
          case Tag.ForOfStatement:
            walk(i.value.blockDecls = new Set())
            break
          }
        }
      }
    }
    walk()
    return sa
  })

/** puts init field before id in VariableDeclarator and for-of, for-in */
function reorderVarDecl(si) {
  const s = Kit.auto(si)
  function* walk(sw) {
    for(const i of sw) {
      yield i
      if (i.enter) {
        switch(i.type) {
        case Tag.VariableDeclarator:
          if (i.value.node.kind !== "var") {
            const id = [...walk(s.one())]
            if (s.curLev() != null) {
              assert.equal(s.curLev().pos,Tag.init)
              yield* walk(s.one())
            }
            yield* id
          }
          break
        case Tag.AssignmentPattern:
          const left = [...walk(s.one())]
          yield* s.one()
          yield* left
          break
        case Tag.ForOfStatement:
        case Tag.ForInStatement:
          const j = s.curLev()
          if (j.type === Tag.VariableDeclaration) {
            const left = [...walk(s.one())]
            yield* s.one()
            yield* left
          }
          break
        }
      }
    }
  }
  return walk(s)
}

/**
 * assigns unique Symbol object for each variable declaration and usage
 * stores it in sym fields, for root value stores map syms mapping the
 * sym object to a SymbolInfo structure
 * 
 *     interface Sym {
 *       name: String,
 *       orig: String,
 *       num: number,
 *       sym: Symbol,
 *       unordered: boolean,
 *       declScope: TokenValue
 *     }
 * 
 * for each identifier referening variable:
 *
 *     type Value = Value & {sym:Sym,decl?:true} 
 *                        & {blockDecls?:Map<string,Sym>}
 *                        & {root?:boolean}
 * 
 */
export const assignSym = R.pipe(
  resetFieldInfo,
  // collecting each declaration in each block before resolving
  // because function's may use the ones declared after
  function collectDecls(si) {
    const sa = Kit.toArray(si)
    const s = Kit.auto(sa)
    function walk(root,block,rootSyms,blockSyms) {
      function checkScope(val,syms) {
        const m = new Map()
        for(const i of syms) {
          if (!i.strict || i.funId || i.unordered || i.declScope == null)
            continue
          let l = m.get(i.orig)
          if (l == null)
            m.set(i.orig,l = [])
          l.push(i)
        }
        for(const i of m.values()) {
          if (i.length > 1) {
            throw s.error(`Identifier ${i[0].orig} has already been declared`,
                          i[i.length-1])
          }
        }
        val.blockDecls = new Set(syms)
      }
      function id(i,syms,unordered,funId) {
        const fi = i.value.fieldInfo
        if (fi.declVar) {
          i.value.decl = true
          let {node:{name},sym} = i.value
          if (sym != null)
            name = sym.orig
          sym = sym || (i.value.sym = newSym(name,true))
          syms.push(sym)
          if (name != null && name.length && unordered && root != null)
            root.varScope.set(name,sym)
          if (sym.num == null)
            sym.num = symNum++
          sym.funId = funId
          sym.unordered = unordered
          sym.declScope = root
          sym.declBlock = block
          return sym
        } else if (fi.expr || fi.lval) {
          i.value.decl = false
        }
        return null
      }
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.BlockStatement:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.ForOfStatement:
          case Tag.Program:
            {
              const nextSyms = []
              walk(root,i.value,rootSyms,nextSyms)
              checkScope(i.value,nextSyms)
            }
            break
          case Tag.FunctionExpression:
          case Tag.ArrowFunctionExpression:
          case Tag.File:
          case Tag.FunctionDeclaration:
          case Tag.ObjectMethod:
          case Tag.ClassDeclaration:
          case Tag.ClassExpression:
          case Tag.ClassMethod:
            if (i.leave)
              break
            i.value.varScope = new Map()
            const nextSyms = []
            const ti = symInfo(i.type)
            let j = s.peel()
            if (j.pos === Tag.id) {
              const fd = ti.funDecl
              id(j,fd && rootSyms != null ? rootSyms : nextSyms,fd,true)
              assert.ok(j.value.sym)
              Kit.skip(s.one())
              Kit.skip(s.leave())
              j = s.peel()
            }
            if (j.pos === Tag.params) {
              for(const k of s.sub()) {
                if (k.enter && k.type === Tag.Identifier)
                  id(k,nextSyms,false,false)
              }
              Kit.skip(s.leave())
              j = s.peel()
            }
            assert.ok(j.pos === Tag.body || j.pos === Tag.program)
            j.value.root = true
            walk(i.value,j.value,nextSyms,nextSyms)
            checkScope(j.value,nextSyms)
            Kit.skip(s.leave())
            break
          case Tag.VariableDeclaration:
            const unordered = i.value.node.kind === "var"
            const dstSyms = unordered ? rootSyms : blockSyms
            for(const j of s.sub()) {
              if (j.enter && !j.leave && j.type === Tag.VariableDeclarator) {
                const k = s.curLev()
                if(k && k.pos === Tag.id) {
                  for(const l of s.one()) {
                    if (l.enter && l.type === Tag.Identifier)
                      id(l,dstSyms,unordered,false)
                  }
                }
                walk(root,block,rootSyms,blockSyms)
              }
            }
            break
          case Tag.CatchClause:
            if (s.cur().pos === Tag.param) {
              const nextSyms = []
              for(const j of s.one()) {
                if (j.enter && j.type === Tag.Identifier) {
                  id(j,nextSyms)
                }
              }
              walk(root,i.value,rootSyms,nextSyms)
              checkScope(i.value,nextSyms)
            }
            break
          case Tag.Identifier:
            const fi = i.value.fieldInfo
            if (fi.declVar) {
              id(i,blockSyms)
            } else if (fi.expr || fi.lval)
              i.value.decl = false
            break
          }
        }
      }
    }
    walk(s.first.value.body)
    return sa
  },
  function assignSym(si) {
    const sa = Kit.toArray(si)
    // unfortunately this is not right in JS
    // could be possible something like:
    //    for(const a in a) {}
    // const s = Kit.auto(reorderVarDecl(sa))
    const s = Kit.auto(sa)
    const root = s.first.value
    function decls(scope,par) {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.Identifier:
            let {sym} = i.value
            if (i.value.decl === true) {
              if (sym.strict && (!sym.unordered || sym.funId))
                scope.set(sym.name,sym)
            } else if (i.value.decl === false) {
              if (sym == null) {
                const {name} = i.value.node
                let sym = scope.get(name)
                if (sym == null) {
                  let undef = globals.get(name)
                  if (undef == null) {
                    globals.set(name,undef = newSym(name,true))
                    undef.num = -1
                    undef.unordered = false
                    undef.declScope = null
                  }
                  i.value.sym = undef
                  break
                }
                i.value.sym = sym
              }
            }
            break
          case Tag.BlockStatement:
          case Tag.CatchClause:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.Program:
          case Tag.ForOfStatement:
            const npar = new Map(par)
            for(const sym of i.value.blockDecls) {
              if (sym.strict) {
                npar.set(sym.name,sym)
                if (sym.unordered)
                  scope.set(sym.name,sym)
              }
            }
            decls(new Map(scope),npar)
            break
          case Tag.FunctionExpression:
          case Tag.File:
          case Tag.FunctionDeclaration:
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
          case Tag.ArrowFunctionExpression:
            const nscope = new Map(par)
            for(const sym of par.values()) {
              nscope.set(sym.name,sym)
            }
            decls(nscope,par)
            break
          }
        }
      }
    }
    decls(new Map(),new Map())
    return sa
  })

/** 
 * for each variable sets its usages scope (list of functions where the 
 * variable is used except declaration function)
 * 
 *     type Sym = Sym & { refScopes: Set<TokenValue> }
 */
export function calcRefScopes(si) {
  const sa = Kit.toArray(si)
  const s = Kit.auto(sa)
  function scope(root) {
    for(const i of s.sub()) {
      if (i.enter) {
        if (i.value.func) {
          scope(i.value)
        } else if (i.type === Tag.Identifier) {
          const si = i.value.sym
          if (si != null && si.declScope !== root)
            (si.refScopes || (si.refScopes = new Set())).add(root)
        }
      }
    }
  }
  scope(s.first.value)
  return sa
}

/** 
 * for each block calculates a set of variables referenced in it 
 *
 *    type Value = Value * { varRefs?: Set<Sym> }
 */
function calcBlockRefs(si) {
  const sa = Kit.toArray(si)
  const s = Kit.auto(sa)
  function walk(refs) {
    for(const i of s.sub()) {
      if (i.enter) {
        if (i.value.blockDecls != null && !i.leave) {
          const nrefs = new Set([...i.value.blockDecls]/*.filter(i => !i.funId)*/)
          walk(nrefs)
          i.value.varRefs = new Set(nrefs)
          for(const j of i.value.blockDecls)
            nrefs.delete(j)
          nrefs.forEach(refs.add,refs)
        }
        if (i.type === Tag.Identifier
            && i.value.sym != null
            && i.value.decl === false) {
          refs.add(i.value.sym)
        }
      }
    }
  }
  walk(new Set())
  return sa
}

const nameOpts = ["a","b","c","d","e","f","g","h","k","m","n","x","y","z"]

function namePos(n,pos) {
  if (n[n.length-1] === "_")
    return n + (pos+1)
  if (pos === 0)
    return n
  if (pos === 1)
    return "_" + n
  return `${n}${pos-1}`
}

/** 
 * after adding some names, there may be some naming conflicts
 * this pass resolves them by looking for same name but different symbols ids
 * and renaming them accordingly
 */
function solve(si) {
  const sa = Kit.toArray(si)
  const root = sa[0].value
  const refsFrames = []   //: Sym[][]
  const symVals = [...globals.values()]
  const anyPat = new Map()
  const ids = []
  for(const i of sa) {
    if (i.enter) {
      if (i.value.varRefs != null) {
        const refs = [...i.value.varRefs].sort((a,b) => a.num - b.num) //:Sym[]
        if (refs.length)
          refsFrames.push(refs)
        for(const i of refs) {
          if (i.name === "") {
            let ap = anyPat.get(i)
            if (ap == null)
              anyPat.set(i,ap = new Set())
            refs.forEach(ap.add,ap)
          }
        }
      }
      if (i.type === Tag.Identifier && i.value.sym != null) {
        ids.push(i.value)
        if (i.value.decl === true)
          symVals.push(i.value.sym)
      }
    }
  }
  for(const [s,is] of [...anyPat].sort((a,b) => a[0].num - b[0].num)) {
    const ism = new Map()
    for(const i of is)
      if (i.name != null)
        ism.set(i.name,(ism.get(i) || 0)+1)
    let mn, mv
    for(const i of nameOpts) {
      const c = ism.get(i)
      if (!c) {
        mv = i
        break
      }
      if (mn == null || mn > c) {
        mn = c
        mv = i 
      }
    }
    s.name = mv
  }
  // temporarly extending Sym with
  // type Sym = Sym & {dom:Set<number>,namePos:number}
  const store = new Map() //: Map<String,Sym[][]>,
  for(const i of symVals) {
    let fi = store.get(i.name)
    if (fi == null)
      store.set(i.name,fi = new Set())
  }
  for(const i of refsFrames) {
    const names = new Set(i.map(j => j.name))
    for(const j of names) {
      let fi = store.get(j)
      if (fi == null)
        store.set(j,fi = new Set())
      fi.add(i.filter(k => k.name === j))
    }
  }
  const names = new Set(store.keys())
  up: for(const [n,refs] of store) {
    for(const i of refs)
      if (i.length > 1)
        continue up
    store.delete(n)
  }
  for(const [n,refs] of store) {
    const syms = new Set([].concat(...refs))
    const osyms = [...syms].sort((a,b) => a.num - b.num)
    for(const i of osyms)
      i.dom = new Set()
    for(const i of osyms) {
      let pos = 0, nn
      for(;;pos++) {
        if (i.dom.has(pos))
          continue
        nn = namePos(n,pos)
        if (pos > 0 && names.has(nn))
          continue
        break
      }
      i.name = nn
      for(const j of refs) {
        if (j.length && j[0] === i) {
          j.shift()
          for(const k of j)
            k.dom.add(pos)
        }
      }
    }
  }
  for(const i of ids)
    i.node.name = i.sym.name
  return sa
}

export const prepare = R.pipe(
//  calcUnorderedScope,
  assignSym)

export const resolve = R.pipe(
  //  resetSym,
  assignSym,
  calcBlockRefs,
  solve)

