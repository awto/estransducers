import * as Kit from "./kit"
import * as R from "ramda"
import {Tag,TypeInfo as TI,symbol,tok,resetFieldInfo} from "./core"
import * as assert from "assert"
import * as Trace from "./trace"

const globals = new Map()

let symNum = 0
let curSymId = 0

// String -> Sym
export function newSym(name = "") {
  return { name, orig: name, id: `${name}@${curSymId++}` }
}

/** 
 * resets symbol number and value decl field 
 * for new identifiers from transform passes
 */
export const resetSym = R.pipe(
  resetFieldInfo,
  function* resetSym(s) {
    for(const i of s) {
      if (i.enter && i.type === Tag.Identifier
          && i.value.sym != null) {
        if (i.value.decl == null) {
          const fi = i.value.fieldInfo
          i.value.decl = fi.declVar
        }
        if (i.value.decl) {
          if (i.value.sym.num == null)
            i.value.sym.num = symNum++        
          i.value.sym.name = i.value.sym.orig
        }
      }
      yield i
    }
  })

/**
 * calculates unordered definitions scope, i.e, var kind variable declarations
 * or function declarations
 * 
 * for scope nodes:
 *
 *     type Value = Value & {varScope: Map<String,Value>}
 * 
 * the Value in the Map pointes to Identifier's Value
 */
export function calcUnorderedScope(si) {
  const sa = Kit.toArray(si)
  let s = Kit.auto(sa)
  const root = s.first.value
  function walk(scope) {
    for(const i of s.sub()) {
      if (i.enter) {
        switch(i.type) {
        case Tag.VariableDeclaration:
          if (i.value.node.kind === "var") {
            Kit.skip(s.peelTo(Tag.declarations))
            const unordered = i.value.node.kind === "var"
            for(const j of s.sub()) {
              if (j.enter) {
                assert.equal(s.cur().pos, Tag.id)
                for(const k of s.one()) {
                  if (k.enter && k.type === Tag.Identifier
                      && k.value.sym == null
                      && k.value.node.name != null) {
                    scope.set(k.value.node.name,k.value)
                    k.value.unordered = unordered
                  }
                }
                if (s.curLev() != null)
                  walk(scope)
              }
            }
            Kit.skip(s.leave())
          }
          break
        case Tag.Identifier:
          if (i.value.decl)
            i.value.unordered = null
          break
        case Tag.ClassDeclaration:
        case Tag.FunctionDeclaration:
          const j = s.curLev()
          if (j != null) {
            assert.equal(j.pos,Tag.id)
            if (j.value.node.name != null)
              scope.set(j.value.node.name,j.value)
            j.value.unordered = true
            walk(i.value.varScope = new Map())
          } 
        case Tag.FunctionExpression:
        case Tag.ObjectMethod:
        case Tag.ClassMethod:
          const k = s.curLev()
          if (k != null) {
            const iscope = i.value.varScope = new Map()
            if (k.pos === Tag.id && k.value.node.name != null)
              iscope.set(k.value.node.name,k.value)
            walk(iscope)
          }
          break
        case Tag.ArrowFunctionExpression:
          if (s.curLev() != null)
            walk(i.value.varScope = new Map())
          break
        }
      }
    }
  }
  walk(root.varScope = new Map())
  return sa
}

/** puts init field before id in VariableDeclarator */
function reorderVarDecl(si) {
  const s = Kit.auto(si)
  function* walk(sw) {
    for(const i of sw) {
      yield i
      if (i.enter && i.type === Tag.VariableDeclarator
          && i.value.node.kind !== "var") {
        const id = [...walk(s.one())]
        if (s.curLev() != null) {
          assert.equal(s.curLev().pos,Tag.init)
          yield* walk(s.one())
        }
        yield* id
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
 * 
 */
export const assignSym = R.pipe(
  resetFieldInfo,
  function assignSym(si) {
    function addVarScope(scope,i) {
      if (i.value.varScope != null) {
        for(const [j,jv] of i.value.varScope) {
          scope.set(j,jv.sym || (jv.sym = newSym(j)))
        }
      }
      return scope
    }
    const sa = Kit.toArray(si)
    const s = Kit.auto(reorderVarDecl(sa))
    const root = s.first.value
    function decls(scope,unordered,root) {
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.Identifier:
            const fi = i.value.fieldInfo
            if (fi.declVar) {
              i.value.decl = true
              let {node:{name},sym} = i.value
              if (i.value.unordered) {
                if (sym == null) {
                  sym = i.value.sym = newSym(name)
                  root.varScope.set(name,i.value)
                  scope.set(name,sym)
                }
              } else {
                sym = sym || (i.value.sym = newSym(name))
                scope.set(name,sym)
              }
              if (sym.num == null)
                sym.num = symNum++
              sym.name = sym.orig
              sym.unordered = i.value.unordered || unordered
              sym.declScope = root
            } else if (fi.expr || fi.lval) {
              i.value.decl = false
              if (i.value.sym == null) {
                const {name} = i.value.node
                let sym = scope.get(name)
                if (sym == null) {
                  const undef = globals.get(name)
                  if (undef == null) {
                    sym = newSym(name)
                    globals.set(name,sym)
                    i.value.sym = sym
                    sym.num = -1
                    sym.unordered = false
                    sym.declScope = null
                  } else {
                    i.value.sym = undef
                  }
                  break
                }
                i.value.sym = sym
              }
            }
            break
          case Tag.VariableDeclaration:
            decls(scope,i.value.node.kind === "var",root)
            break
          case Tag.BlockStatement:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.ForOfStatement:
            decls(new Map(scope),false,root)
            break
          case Tag.File:
          case Tag.FunctionDeclaration:
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
          case Tag.FunctionExpression:
          case Tag.ArrowFunctionExpression:
            decls(addVarScope(new Map(scope),i),false,i.value)
            break
          }
        }
      }
    }
    decls(new Map(),false,s.first.value)
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
 *    type Value = Value * { varRefs?: Sym[] }
 */
export function calcBlockRefs(si) {
  const sa = Kit.toArray(si)
  const s = Kit.auto(sa)
  function scope(value,rootDecls) {
    function block(value,decls,refs) {
      function walk(unordered) {
        for(const i of s.sub()) {
          if (i.enter) {
            switch(i.type) {  
            case Tag.VariableDeclaration:
              walk(i.value.node.kind === "var")
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
              if (i.value.sym != null) {
                if (i.value.decl)
                  (unordered ? rootDecls : decls).add(i.value.sym)
                refs.add(i.value.sym)
              }
              break
            }
          }
        }
      }
      walk()
      Kit.skip(s.leave())
      value.varRefs = decls.size ? refs : null
      value._debRefs = refs
      value._debDecls = decls
      return [...refs].filter(j => !decls.has(j))
    }
    const varKindDecls = value.varScope
          && [...value.varScope.values()].map(i => i.sym) || []
    let res
    const params = new Set()
    for(const i of s.sub()) {
      if (i.enter) {
        if (i.type === Tag.Identifier && i.value.decl != null) {
          if (i.value.decl)
            params.add(i.value.sym)
        } else if (i.pos === Tag.body) {
          rootDecls.forEach(rootDecls.add,rootDecls)
          params.forEach(rootDecls.add,rootDecls)
          res = block(i.value,
                      i.value._debRootDecls = rootDecls,
                      i.value._debRootRefs = new Set(varKindDecls))
        }
      }
    }
    return res || new Set()
  }
  scope(s.peel().value,new Set())
  return sa
}

const nameOpts = ["a","b","c","d","e","f","g","h","k","m","n","x","y","z"]

function namePos(n,pos) {
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
export function solve(si) {
  const sa = Kit.toArray(si)
  const root = sa[0].value
  const refsFrames = []   //: Sym[][]
  const symVals = [...globals.values()]
  const anyPat = new Map()
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
      if (i.type === Tag.Identifier && i.value.decl === true)
        symVals.push(i.value.sym)
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
  for(const i of sa) {
    if (i.enter && i.type === Tag.Identifier && i.value.sym != null) {
      i.value.node.name = i.value.sym.name
    }
  }
  return sa
}

export const prepare = R.pipe(
  calcUnorderedScope,
  assignSym)

export const resolve = R.pipe(
  resetSym,
  calcBlockRefs,
  solve)

