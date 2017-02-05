import {VISITOR_KEYS,NODE_FIELDS,ALIAS_KEYS,BUILDER_KEYS} from "babel-types"
import * as assert from "assert"

const GLOBAL_SYMBOLS = true

let nameCount = 0

const symbols = new Map()
const symbolsComputed = new Map()

export function symInfo(sym) {
  return symbols.get(sym)
}

export function typeInfo(i) {
  const node = i.value.node
  if (node && node.computed) {
    const res = symbolsComputed.get(i.type)
    if (res != null)
      return res
  }
  return symInfo(i.type)
}

export const symName = GLOBAL_SYMBOLS
  ? Symbol.keyFor
  : (s) => symbols.get(s).name

export const newSymbol = GLOBAL_SYMBOLS ? Symbol.for : Symbol

export function nodeInfo(node) {
  const sym = Tag[node.type]
  if (node.computed) {
    const res = symbolsComputed.get(sym)
    if (res != null)
      return res
  }
  return symbols.get(sym)
}

export function symKind(sym) {
  return symbols.get(sym).kind
}

export function fieldInfo(type,field) {
  const e = symbols.get(type)
  if (e == null || e.fieldsMap == null)
    return null
  return e.fieldsMap.get(field)
}

export function symbol(name,kind = "ctrl") {
  assert.ok(name && name.substr)
  assert.ok(isNaN(name))
  const res = newSymbol(name)
  symbols.set(res,{
    sym:res,
    name,
    kind,
    x:nameCount++
  })
  return res
}

function symbolDefFor(name, kind) {
  assert.ok(name && name.substr)
  assert.ok(isNaN(name))
  let sym = Tag[name], def
  if (sym == null) {
    Tag[name] = sym = newSymbol(name)
    def = { sym,name,kind,x:nameCount++, expr: false, block: false, key: false,
            lval: false, decl: false, func: false }
    if (kind === "node")
      def.esType = name
    symbols.set(sym,def)
  } else {
    def = symbols.get(sym)
    assert.ok(def)
    assert.equal(kind, def.kind, `for ${name}`)
  }
  return def
}

export const TypeInfo = {}

export const Tag = {push:symbol("push","pos"),
                    top:symbol("top","pos"),
                    Array:symbol("Array","array"),
                    Node:symbol("Node","node"),
                    Null:symbol("Null","null")}

for(const i in VISITOR_KEYS) {
  const def = TypeInfo[i] = symbolDefFor(i,"node")
  for(const j of VISITOR_KEYS[i])
    symbolDefFor(j,"pos").visitor = true
  for(const j of BUILDER_KEYS[i])
    symbolDefFor(j,"pos").builder = true
}
for(const i in ALIAS_KEYS) {
  const def = symbolDefFor(i,"node")
  const aliases = def.aliases || (def.aliases = new Set())
  const aliasKeys = ALIAS_KEYS[i]
  if (aliasKeys != null) {
    for(const j of aliasKeys) {
      const adef = symbolDefFor(j,"alias");
      (adef.instances || (adef.instances = new Set())).add(def.sym)
      aliases.add(adef.sym)
    }
  }
}
{
  const idDef = symbols.get(Tag.Identifier)
  idDef.fieldsMap = new Map([[Tag.name,
                              {atomicType:"string",
                               nodeTypes:new Set(),
                               nillable:false,
                               enumValues:null,
                               default: null
                              }]])
  const meDef = symbols.get(Tag.MemberExpression)
  meDef.fieldsMap = new Map([[Tag.property,
                              {atimicType:null,
                               nodeTypes:new Set([Tag.Identifier]),
                               nillable:false,
                               enumValues:null,
                               default: null}]])
  
}

for(const i in VISITOR_KEYS) {
  const nodeFields = NODE_FIELDS[i]
  const def = symbols.get(Tag[i])
  if (nodeFields != null) {
    const fieldsMap = def.fieldsMap || (def.fieldsMap = new Map())
    for(const j in nodeFields) {
      const jdef = nodeFields[j]
      const fdef = symbolDefFor(j,"pos")
      if (fieldsMap.has(fdef.sym))
        continue
      const info = getTy(jdef.validate)
      info.default = jdef.default
      fieldsMap.set(fdef.sym,info)
    }
  }
  function getTy(ty) {
    let enumValues = null,
    nt = new Set(),
    atomicType = null,
    nillable = false
    if (ty != null && ty.chainOf != null) {
      assert.equal(ty.chainOf.length, 2)
      if (ty.chainOf[0].type === "array") {
        const elem = getTy(ty.chainOf[1].each)
        return {
          array: true,
          elem: elem,
          fieldsMap: new Map([[Tag.push,elem]])
        }
      } else if (ty.chainOf[0].type === "string") {
        assert.ok(ty.chainOf[1].oneOf)
        enumValues = ty.chainOf[1].oneOf
        atomicType = "string"
        ty = null
      } else {
        throw new Error("not implemented")
      }
    }
    if (ty != null) {
      if (ty.type != null) {
        atomicType = ty.type
      } else if (ty.oneOfNodeTypes != null) {
        for(const k of ty.oneOfNodeTypes) {
          const p = Tag[k]
          assert.ok(p)
          nt.add(p)
        }
      } else if (ty.oneOf != null) {
        enumValues = ty.oneOf
        atomicType = "string"
      } else if (ty.oneOfNodeOrValueTypes != null) {
        nt = new Set()
        for(const k of ty.oneOfNodeOrValueTypes) {
          if (k === "null") {
            nillable = true
          } else {
            const p = Tag[k]
            assert.ok(p,`no such type ${k}, ${Object.keys(Tag)}`)
            nt.add(p)
          }
        }
      } else {
        atomicType = "any"
      }
    }
    if (enumValues != null) {
      nillable = nillable || enumValues.indexOf(null) !== -1
      enumValues = enumValues.filter(i => i != null)
      assert.equal(enumValues.filter(v => v.substr == null).length,0)
    }
    return {
      atomicType,nodeTypes:nt,nillable,enumValues,
      expr: nt.has(Tag.Expression),
      stmt: (nt.has(Tag.Statement) || nt.has(Tag.BlockStatement)),
      block: nt.has(Tag.BlockStatement) && !nt.has(Tag.Statement),
      key: nt.has(Tag.Identifier) && !nt.has(Tag.Expression),
      lval: nt.has(Tag.LVal),
      decl: (nt.has(Tag.VariableDeclaration) || nt.has(Tag.Declaration))
    }
  }
}

for(const i in VISITOR_KEYS) {
  const def = symbols.get(Tag[i])
  const aliases = def.aliases
  def.func = aliases.has(Tag.Function)
  def.scope = aliases.has(Tag.FunctionParent)
  def.expr = aliases.has(Tag.Expression)
  def.decl = aliases.has(Tag.Declaration)
  def.stmt = aliases.has(Tag.BlockStatement) || aliases.has(Tag.Statement)
  def.block = aliases.has(Tag.BlockStatement) && !aliases.has(Tag.Statement)
}

for(const i in Tag) {
  Tag[Tag[i]] = Tag[i]
}

function setComputed(nm,prop,tys) {
  const cnm = `${nm}Computed`
  const sym = Tag[nm]
  const csym = Tag[cnm] = newSymbol(cnm)
  const me = symbols.get(sym)
  const mec = Object.assign({},me,{sym:csym})
  symbols.set(csym,mec)
  mec.fieldsMap = new Map(me.fieldsMap)
  mec.fieldsMap.set(prop,{atomicType:null,
                          nodeTypes:new Set([Tag.Expression])})
  me.fieldsMap.set(prop,{atomicType:null,
                          nodeTypes:new Set(tys)})
  symbolsComputed.set(sym,mec)
}

setComputed("MemberExpression",Tag.property,[Tag.Identifier])
setComputed("ObjectProperty",Tag.key,
            [Tag.Identifier, Tag.StringLiteral, Tag.NumericLiteral])
setComputed("ObjectMethod",Tag.key,
            [Tag.Identifier, Tag.StringLiteral, Tag.NumericLiteral])
function isNode(node) {
  if (node == null)
    return false;
  return typeof node === 'object' && typeof node.type === 'string';
}

export function enter(pos,type,value) {
  return {enter:true,leave:false,pos,type,value}
}

export function leave(pos,type,value) {
  return {enter:false,leave:true,pos,type,value}
}

export function tok(pos,type,value) {
  return {enter:true,leave:true,pos,type,value}
}

export function* produce(node,pos) {
  function* walk(node,pos) {
    if (Array.isArray(node)) {
      const value = {node}
      yield enter(pos,Tag.Array,value)
      for(const i of node)
        yield* walk(i,Tag.push)
      yield leave(pos,Tag.Array,value)
    } else if (isNode(node)) {
      const keys = VISITOR_KEYS[node.type]
      const ti = nodeInfo(node)
      const type = ti.sym
      if (keys.length) {
        const value = {node}
        yield enter(pos,type,value)
        for(const i of keys) {
          const v = node[i]
          if (v != null)
            yield* walk(node[i],Tag[i] || i)
        }
        yield leave(pos,type,value)
      } else {
        yield tok(pos,type,{node})
      }
    }
  }
  yield* walk(node,pos || Tag.top)
}

export function toArray(s) {
  if (Array.isArray(s))
    return s
  return [...s]
}

/**
 * same as consume but returns token's sequence with all fields
 * reset in its values
 */
function* reproduce(s) {
  const stack = [{}]
  const res = []
  for (const i of s) {
    res.push(i)
    if (i.type == null || !Tag[Symbol.keyFor(i.type)])
      continue
    if (i.enter) {
      if (i.type === Tag.Array) {
        stack.unshift(i.value.node = [])
      } else  {
        if (i.value != null)
          i.value.type = symName(i.type)
        stack.unshift(i.value.node)
      }
    }
    if (i.leave) {
      const value = stack.shift()
      if (i.pos === Tag.push) {
        stack[0].push(value)
      } else
        stack[0][Symbol.keyFor(i.pos)] = value
    }
  }
  return res
}

export function consume(s) {
  const stack = [{}]
  for (const i of s) {
    const ti = typeInfo(i)
    if (i.type == null || ti.kind === "ctrl")
      continue
    if (i.enter) {
      if (i.type === Tag.Array)
        stack.unshift([])
      //TODO: another step to handle nulls
      else if (i.type === Tag.Null) {
        if (i.pos !== Tag.push)
          stack[0][symName(i.pos)] = null
        continue
      } else {
        if (i.value != null) {
          if (ti.esType != null)
            i.value.node.type = ti.esType
          if (ti.fields)
            Object.assign(i.value.node,ti.fields)
        }
        stack.unshift(i.value.node)
      }
    }
    if (i.leave) {
      const node = stack.shift()
      if (i.pos === Tag.push) {
        stack[0].push(node)
      } else
        stack[0][symName(i.pos)] = node
    }
  }
  return stack[0]
}

/** 
 * unwraps tokens formerly folded into Node sub-token
 */
export function* reproduceNodes(s) {
  for(const i of s) {
    if (i.type === Tag.Node) {
      if (i.enter) {
        yield* produce(i.value.node,i.pos)
      } else
        yield i
    }
  }
}

export function* resetFieldInfo(s) {
  const stack = []
  for(const i of s) {
    if (i.enter) {
      const ti = typeInfo(i)
      const f = stack[stack.length-1]
      if (f && f.fieldsMap)
        i.value.fieldInfo = f.fieldsMap.get(i.pos)
      switch(ti.kind) {
      case "array":
        stack.push(i.value.fieldInfo)
        break
      case "node":
        stack.push(ti)
        break
      default:
        stack.push(false)
      }
    }
    if (i.leave)
      stack.pop()
    yield i
  }
}

export function* removeNulls(s) {
  const stack = []
  for(const i of s) {
    if (i.type === Tag.Null) {
      if (i.enter && stack[0]) {
        if (i.pos != Tag.push)
          stack[0][symName(i.pos)] = null
      }
      continue
    }
    yield i
    if (i.enter)
      stack.unshift(i.value.node)
    if (i.leave)
      stack.shift()
  }
}
