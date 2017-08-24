import * as Kit from "./kit"
import {Tag,TypeInfo as TI,symbol,tok,resetFieldInfo,symInfo} from "./core"
import * as assert from "assert"
import * as Trace from "./trace"

let symNum = 0
let curSymId = 0

symInfo(Tag.ClassDeclaration).funDecl = true
symInfo(Tag.FunctionDeclaration).funDecl = true

// String -> Sym
export function newSym(name, strict = false, decl) {
  if (!name)
    name = ""
  return { name,
           orig: name,
           id: `${name}_${curSymId++}`,
           strict,
           decl,
           num: symNum++}
}

export const undefinedSym = newSym("undefined", true)
export const argumentsSym = newSym("arguments", true)

const globals = new Map([["undefined",undefinedSym],
                         ["arguments",argumentsSym]])

/**
 * sets temporal `node.name` for each Identifier for debug dumps outputs
 */
export function* tempNames(s) {
  for(const i of s) {
    if (i.enter && i.type === Tag.Identifier
        && i.value.sym != null
        && i.value.node.name == null) {
      i.value.node.name = i.value.sym.strict
        ? i.value.sym.name
        : i.value.sym.id 
    }
    yield i
  }
}

/**
 * resets symbols decl map for resolving names
 * for new identifiers from transform passes,
 * the transform pass has to use sym field to identifier 
 * symbols in `Identifier` nodes
 */
export const resetSym = Kit.pipe(
  resetFieldInfo,
  function resetSym(si) {
    const sa = Kit.toArray(si)
    const s = Kit.auto(sa)
    function id(i, blockScope) {
      const {sym} = i
      if (sym != null) {
        if (i.decl == null) {
          const fi = i.fieldInfo
          i.decl = fi.declVar
        }
        //if (sym.num == null)
        //  sym.num = symNum++
        if (sym.orig != null)
          sym.name = sym.orig
        if (i.node.name == null)
          i.node.name = sym.name
        if (i.decl && blockScope != null)
          blockScope.add(sym)
      }
    }
    function walk(sw,blockScope) {
      for(const i of sw) {
        if (i.enter) {
          switch(i.type) {
          case Tag.Identifier:
            id(i.value,blockScope)
            break
          case Tag.FunctionDeclaration:
            const j = s.curLev()
            if (j) {
              id(j.value,blockScope)
              Kit.skip(s.one())
            }
          case Tag.FunctionExpression:
          case Tag.ObjectMethod:
          case Tag.ClassMethod:
          case Tag.ArrowFunctionExpression:
            // parameters must be added to body's scope
            const nscope = new Set()
            for(let j; (j = s.curLev()) != null;) {
              if (j.pos === Tag.body) {
                s.take()
                walk(s.sub(), j.value.decls = nscope)
              } else {
                walk(s.one(), nscope)
              }
            }
            break
          case Tag.BlockStatement:
          case Tag.CatchClause:
          case Tag.ForStatement:
          case Tag.ForInStatement:
          case Tag.Program:
          case Tag.ForAwaitStatement:
          case Tag.ForOfStatement:
            walk(i.value.decls = new Set())
            break
          }
        }
      }
    }
    walk(s)
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
        case Tag.ForAwaitStatement:
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

export function cloneSym(sym) {
  const res = newSym(sym.orig)
  res.declScope = sym.declScope
  res.declLoop = sym.declLoop
  res.captLoop = sym.captLoop
  res.declBlock = sym.declBlock
  res.decl = sym.decl
  res.param = sym.param
  return res
}

/**
 * assigns unique Symbol object for each variable declaration and usage
 * stores it in sym fields, for root value stores map syms mapping the
 * sym object to a SymbolInfo structure
 * 
 *     interface Sym {
 *       name: String;
 *       orig: String;
 *       num: number;
 *       sym: Symbol;
 *       unordered: boolean;
 *       declScope: TokenValue;
 *       declLoop?: TokenValue; -- loop scope
 *       captLoop?: TokenValue; -- loop to be captured in
 *       declBlock?: TokenValue;
 *       decl?: TokenValue;
 *       param?: TokenValue;
 *     }
 * 
 * for each identifier referening variable:
 *
 *     type Value = Value & {sym:Sym,decl?:true} 
 *                        & {decls?:Map<string,Sym>}
 *                        & {root?:boolean}
 * 
 */
export const assignSym = (report) => Kit.pipe(
  resetFieldInfo,
//  Trace.all("ASI"),
  // collecting each declaration in each block before resolving
  // because function's may use the ones declared after
  function collectDecls(si) {
    const sa = Kit.toArray(si)
    const s = Kit.auto(sa)
    function walk(func,block,funcSyms,blockSyms,loop) {
      function checkScope(val,syms) {
        // checking the scope only the first time
        if (report) {
          const m = new Map()
          for(const i of syms) {
            if (!i.strict || i.func || i.unordered || i.declScope == null)
              continue
            let l = m.get(i.orig)
            if (l == null)
              m.set(i.orig,l = [])
            l.push(i)
          }
          for(const i of m.values()) {
            if (i.length > 1) {
              throw s.error(`Identifier ${i[0].orig} has already been declared`,
                            i[i.length-1].decl)
            }
          }
        }
        val.decls = new Set(syms)
      }
      function id(i,syms,unordered,loop) {
        const fi = i.value.fieldInfo
        if (fi.declVar) {
          i.value.decl = true
          let {node:{name},sym} = i.value
          if (sym != null)
            name = sym.orig
          sym = sym || (i.value.sym = newSym(name,true,i.value))
          syms.push(sym)
          sym.unordered = unordered
          sym.declScope = func
          sym.declBlock = block
          sym.declLoop = sym.captLoop = unordered ? null : loop
          sym.param = null
          sym.func = null
          sym.decl = i
          return sym
        } else if (fi.expr || fi.lval) {
          i.value.decl = false
        }
        return null
      }
      for(const i of s.sub()) {
        if (i.enter) {
          switch(i.type) {
          case Tag.ThisExpression:
            break
          case Tag.ForStatement:
            {
              const nextSyms = []
              const ini = s.cur()
              if (ini.pos === Tag.init
                  && ini.type === Tag.VariableDeclaration
                  && ini.value.node.kind !== "var") {
                s.take()
                walk(func,i.value,funcSyms,nextSyms,loop)
                for(const j of nextSyms)
                  j.captLoop = i.value
                s.close(ini)
              }
              walk(func,i.value,funcSyms,nextSyms,i.value)
              checkScope(i.value,nextSyms)
            }
            break
          case Tag.ForInStatement:
          case Tag.ForAwaitStatement:
          case Tag.ForOfStatement:
            {
              const nextSyms = []
              walk(func,i.value,funcSyms,nextSyms,i.value)
              checkScope(i.value,nextSyms)
            }
            break
          case Tag.BlockStatement:
          case Tag.Program:
            {
              const nextSyms = []
              walk(func,i.value,funcSyms,nextSyms,loop)
              checkScope(i.value,nextSyms)
            }
            break
          case Tag.ClassMethod:
          case Tag.ObjectMethod:
            const k = s.take()
            assert.equal(k.pos, Tag.key)
            if (!k.leave) {
              walk(block,funcSyms,blockSyms,loop)
              s.close(k)
            }
          case Tag.ArrowFunctionExpression:
          case Tag.FunctionExpression:
          case Tag.File:
          case Tag.FunctionDeclaration:
          case Tag.ClassDeclaration:
          case Tag.ClassExpression:
            if (i.leave || s.curLev() == null)
              break
            const nextSyms = []
            const ti = symInfo(i.type)
            let j = s.peel()
            let funcId
            if (j.pos === Tag.id) {
              const fd = ti.funDecl
              id(j,
                 fd && funcSyms != null
                   ? s.opts.unsafe ? funcSyms : blockSyms
                   : nextSyms,
                 fd)
              assert.ok(j.value.sym)
              Kit.skip(s.one())
              Kit.skip(s.leave())
              funcId = j.value.sym
              j = s.peel()
            }
            const params = []
            if (j.pos === Tag.params) {
              for(const k of s.sub()) {
                if (k.enter && k.type === Tag.Identifier) {
                  const sym = id(k,nextSyms,false)
                  if (sym) {
                    params.push(sym)
                    sym.param = i.value
                  }
                }
              }
              Kit.skip(s.leave())
              j = s.peel()
            }
            assert.ok(j.pos === Tag.body || j.pos === Tag.program)
            j.value.root = true
            walk(i.value,j.value,nextSyms,nextSyms)
            for(const k of params) {
              k.declScope = i.value
              k.declBlock = j.value
            }
            if (funcId) {
              if (!ti.funDecl) {
                funcId.declScope = i.value
                funcId.declBlock = j.value
              }
              funcId.func = i.value
            }
            i.value.funcId = funcId
            i.value.paramSyms = params
            checkScope(j.value,nextSyms)
            Kit.skip(s.leave())
            break
          case Tag.VariableDeclaration:
            const unordered = i.value.node.kind === "var"
            const dstSyms = unordered ? funcSyms : blockSyms
            for(const j of s.sub()) {
              if (j.enter && !j.leave && j.type === Tag.VariableDeclarator) {
                const k = s.curLev()
                if(k && k.pos === Tag.id) {
                  for(const l of s.one()) {
                    if (l.enter && l.type === Tag.Identifier)
                      id(l,dstSyms,unordered,loop)
                  }
                }
                walk(func,block,funcSyms,blockSyms,loop)
              }
            }
            break
          case Tag.CatchClause:
            if (s.cur().pos === Tag.param) {
              const nextSyms = []
              for(const j of s.one()) {
                if (j.enter && j.type === Tag.Identifier) {
                  id(j,nextSyms,undefined,loop)
                }
              }
              walk(func,i.value,funcSyms,nextSyms,loop)
              checkScope(i.value,nextSyms)
            }
            break
          case Tag.Identifier:
            const fi = i.value.fieldInfo
            if (fi.declVar) {
              id(i,blockSyms,undefined,loop)
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
    const s = Kit.auto(sa)
    const root = s.first.value
    function decls(sw,func,scope,par) {
      for(const i of sw) {
        if (i.enter) {
          switch(i.type) {
          case Tag.Identifier:
            let {sym} = i.value
            if (i.value.decl === true) {
              if (sym.strict && (!sym.unordered || sym.funcId))
                scope.set(sym.name,sym)
            } else if (i.value.decl === false) {
              if (sym == null) {
                const {name} = i.value.node
                let sym = scope.get(name)
                if (sym == null) {
                  let undef = globals.get(name)
                  if (undef == null) {
                    globals.set(name,undef = newSym(name,true,i.value))
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
          case Tag.ForAwaitStatement:
          case Tag.ForOfStatement:
            const npar = new Map(par)
            for(const sym of i.value.decls) {
              if (sym.strict) {
                npar.set(sym.name,sym)
                if (sym.unordered)
                  scope.set(sym.name,sym)
              }
            }
            decls(s.sub(),func,new Map(scope),npar)
            break
          case Tag.ObjectMethod:
            decls(s.one(),func,scope,par)
          case Tag.ArrowFunctionExpression:
          case Tag.FunctionExpression:
          case Tag.File:
          case Tag.FunctionDeclaration:
          case Tag.ClassMethod:
            func.hasArrows = i.type === Tag.ArrowFunctionExpression
            const nscope = new Map(par)
            for(const sym of par.values()) {
              nscope.set(sym.name,sym)
            }
            decls(s.sub(),i.value,nscope,par)
            break
          }
        }
      }
    }
    decls(s,s.first.value,new Map(),new Map())
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
        switch(i.type) {
        case Tag.FunctionDeclaration:
          Kit.skip(s.one())
        case Tag.FunctionExpression:
        case Tag.ObjectMethod:
        case Tag.ClassMethod:
        case Tag.ArrowFunctionExpression:
          scope(i.value)
          break
        case Tag.Identifier:
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
        if (i.value.decls != null && !i.leave) {
          const nrefs = new Set(i.value.decls)
          if (i.value.rootId)
            nrefs.delete(i.value.rootId)
          walk(nrefs)
          i.value.varRefs = new Set(nrefs)
          for(const j of i.value.decls)
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
        if (nn !== n && names.has(nn))
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

export const prepare = assignSym(true)

export const resolve = Kit.pipe(
  resetSym,
  assignSym(false),
  calcBlockRefs,
  solve)

export const tempVar = symbol("tempVar")

export function* emitTempVar() {
  const sym = newSym("_temp")
  yield tok(tempVar,tempVar,{sym})
  return sym
}

/** emit `var` declarations for each `tempVar` */
export const resolveTempVars = Kit.pipe(
  function collectTempVars(si) {
    const s = Kit.auto(si)
    function* walk(b) {
      for(const i of s.sub()){
        if (i.enter) {
          switch(i.type) {
          case Tag.BlockStatement:
          case Tag.Program:
            yield i
            walk(i.value.tempVars = [])
            continue
          case tempVar:
            b.push(i.value.sym)
            s.close(i)
            continue
          }
        }
        yield i
      }
    }
    return walk([])
  },
  Kit.toArray,
  function* emplaceTempVars(si) {
    const s = Kit.auto(si)
    for(const i of s) {
      yield i
      if (i.enter) {
        switch(i.type) {
        case Tag.BlockStatement:
        case Tag.Program:
          if (i.value.tempVars && i.value.tempVars.length) {
            const lab = s.label()
            yield* s.peelTo(Tag.body)
            yield s.enter(Tag.push,Tag.VariableDeclaration,{node:{kind:"var"}})
            yield s.enter(Tag.declarations, Tag.Array)
            for(const sym of i.value.tempVars) {
              yield s.enter(Tag.push, Tag.VariableDeclarator)
              yield s.tok(Tag.id, Tag.Identifier, {sym})
              yield* s.leave()
            }
            yield* lab()
          }
        }
      }
    }
  })
