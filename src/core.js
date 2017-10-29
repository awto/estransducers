import {VISITOR_KEYS,NODE_FIELDS,ALIAS_KEYS,BUILDER_KEYS} from "babel-types"
import * as assert from "assert"

const SYMBOLS_IMPL = "sym"

const GLOBAL_SYMBOLS = SYMBOLS_IMPL === "sym"
const OBJ_SYMBOLS  = SYMBOLS_IMPL === "obj"
const STR_SYMBOLS = SYMBOLS_IMPL === "str"

let nameCount = 0
const symbols = new Map()
//TODO: fields used only with a single type
// const fieldTypes = new Map()

export const symInfo = OBJ_SYMBOLS
  ? function symInfo(sym) { return sym }
  : function symInfo(sym) { return symbols.get(sym) }

export const isSymbol
  = OBJ_SYMBOLS ? function(sym) { return sym && sym.kind != null }
  : STR_SYMBOLS ? function(sym) { return sym.substr != null }
  : function (sym) { return typeof sym === "symbol" }

export function typeInfo(i) {
  return symInfo(i.type)
}

export const symName
  = OBJ_SYMBOLS ? function symName(s) { return s.name }
  : STR_SYMBOLS ? function symName(s) { return s }
  : GLOBAL_SYMBOLS ? Symbol.keyFor
  : function symName(s) { return symInfo(s).name }

const symDict = []

export const newSymbol
  = OBJ_SYMBOLS ? function newSymbol(n) {
    return symDict[n] || (symDict[n] = {sym:null,
                                        name:null,
                                        kind:null,
                                        x:null,
                                        prop:null})
    }
  : STR_SYMBOLS ? function(v) { return v }
  : GLOBAL_SYMBOLS ? Symbol.for
  : Symbol

export function nodeInfo(node) {
  return symInfo(Tag[node.type])
}

export function symKind(sym) {
  return symInfo(sym).kind
}

export function fieldInfo(type,field) {
  const e = symInfo(type)
  if (e == null || e.fieldsMap == null)
    return null
  return e.fieldsMap.get(field)
}

export const symbol = OBJ_SYMBOLS
  ? function symbol(name,kind = "ctrl") {
    const res = {
      sym:null,
      name,
      kind,
      x:nameCount++,
      prop: null
    }
    res.sym = res
    return symDict[name] = res
  } : function symbol(name,kind = "ctrl") {
    const res = newSymbol(name)
    symbols.set(res,{
      sym:res,
      name,
      kind,
      x:nameCount++,
      prop: null
    })
    return res
  }

export const symbolDefFor = OBJ_SYMBOLS
  ? function symbolDefFor(name, kind) {
    let sym = Tag[name]
    if (sym == null) {
      Tag[name] = sym = symDict[name]
        = { sym,name,kind,x:nameCount++, expr: false,
            block: false, key: false,
            lval: false, decl: false, func: false }
      if (kind === "node")
        sym.esType = name
      sym.sym = sym
    } else {
      assert.equal(kind, sym.kind, `for ${name}`)
    }
    return sym
  } : function symbolDefFor(name, kind) {
    let sym = Tag[name], def
    if (sym == null) {
      Tag[name] = sym = newSymbol(name)
      def = { sym,name,kind,x:nameCount++, expr: false,
              block: false,
              key: false,
              lval: false, decl: false, func: false }
      if (kind === "node")
        def.esType = name
      symbols.set(sym,def)
    } else {
      def = symInfo(sym)
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
  const idDef = symInfo(Tag.Identifier)
  idDef.fieldsMap = new Map([[Tag.name,
                              {atomicType:"string",
                               nodeTypes:new Set(),
                               nillable:false,
                               enumValues:null,
                               default: null
                              }]])
  const meDef = symInfo(Tag.MemberExpression)
  meDef.fieldsMap = new Map([[Tag.property,
                              {atimicType:null,
                               nodeTypes:new Set([Tag.Identifier]),
                               nillable:false,
                               enumValues:null,
                               default: null}]])
  
}

for(const i in VISITOR_KEYS) {
  const nodeFields = NODE_FIELDS[i]
  const pos = Tag[i]
  const def = symInfo(pos)
  if (nodeFields != null) {
    const fieldsMap = def.fieldsMap || (def.fieldsMap = new Map())
    for(const j in nodeFields) {
      const jdef = nodeFields[j]
      const fdef = symbolDefFor(j,"pos")
      if (fieldsMap.has(fdef.sym))
        continue
      const info = getTy(jdef.validate,fdef.sym)
      info.default = jdef.default
      fieldsMap.set(fdef.sym,info)
    }
  }
  function getTy(ty,pos) {
    let enumValues = null,
    nt = new Set(),
    atomicType = null,
    nillable = false
    if (ty != null && ty.chainOf != null) {
      assert.equal(ty.chainOf.length, 2)
      if (ty.chainOf[0].type === "array") {
        const elem = getTy(ty.chainOf[1].each)
        if (pos === Tag.params)
          elem.declVar = true
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
    const expr = nt.has(Tag.Expression),
          lval = nt.has(Tag.LVal)
    return {
      atomicType,nodeTypes:nt,nillable,enumValues,expr,
      stmt: nt.has(Tag.Statement),
      block: nt.has(Tag.BlockStatement) && !nt.has(Tag.Statement),
      key: nt.has(Tag.Identifier) && !expr && !lval,
      lval,
      decl: (nt.has(Tag.VariableDeclaration) || nt.has(Tag.Declaration)),
      mod: lval, 
      declVar: pos === Tag.id
    }
  }
}

for(const i in VISITOR_KEYS) {
  const def = symInfo(Tag[i])
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

function setComputed(sym,prop) {
  const me = symInfo(sym)
  me.propAlt = Object.assign(
    {},
    me,
    {fieldsMap: (new Map(me.fieldsMap))
     .set(prop,{atomicType:null,
                nillable:false,
                enumValues:null,
                expr:true,
                stmt:false,
                block:false,
                lval:false,
                decl: false,
                mod: false, 
                declVar: false,
                nodeTypes:new Set([Tag.Expression])})})
  me.prop = Tag.computed
}

setComputed(Tag.ObjectProperty,Tag.key)

// TODO: remove in babel 7
{
  symInfo(Tag.ObjectMethod).fieldsMap
    .set(Tag.params,symInfo(Tag.FunctionExpression).fieldsMap.get(Tag.params))
  symInfo(Tag.ClassMethod).fieldsMap
    .set(Tag.params,symInfo(Tag.FunctionExpression).fieldsMap.get(Tag.params))
  const keyProp = symInfo(Tag.ObjectProperty).fieldsMap.get(Tag.key)
  symInfo(Tag.ObjectMethod).fieldsMap.set(Tag.key,keyProp)
  symInfo(Tag.ClassMethod).fieldsMap.set(Tag.key,keyProp)
  symInfo(Tag.ClassProperty).fieldsMap.set(Tag.key,keyProp)
}

symInfo(Tag.CatchClause).fieldsMap.get(Tag.param).declVar = true
{
  for(const i of [Tag.ImportNamespaceSpecifier,
                  Tag.ImportSpecifier,
                  Tag.ImportDefaultSpecifier])
    symInfo(i).fieldsMap.get(Tag.local).declVar = true
}
setComputed(Tag.MemberExpression,Tag.property)
setComputed(Tag.ObjectMethod,Tag.key)
setComputed(Tag.ClassProperty,Tag.key)
setComputed(Tag.ClassMethod,Tag.key)
symInfo(Tag.UpdateExpression).fieldsMap.get(Tag.argument).mod = true
symInfo(Tag.BlockStatement).block = true
symInfo(Tag.SpreadElement).expr = true
const assignmentOpEq = symInfo(Tag.AssignmentExpression)
const assignmentOpDefault = Object.assign(
    {},assignmentOpEq,
    {fieldsMap:(new Map(assignmentOpEq.fieldsMap))
     .set(Tag.left,
          Object.assign({},assignmentOpEq.fieldsMap.get(Tag.left),{expr:true}))})

{
  const me = symInfo(Tag.AssignmentExpression)
  me.propAlt = Object.assign(
    {},
    me,
    {fieldsMap:(new Map(me.fieldsMap))
     .set(Tag.left,
          Object.assign({},me.fieldsMap.get(Tag.left),{expr:true}))})
  me.prop = Tag.operator
}
const assignmentPattern = symInfo(Tag.AssignmentPattern)
const objectProperty = symInfo(Tag.ObjectProperty)
const assignmentProperty = symbolDefFor("AssignmentProperty","node")
const objectAssignmentPattern = symInfo(Tag.ObjectPattern)
const objectPattern = Object.assign(
  {},objectAssignmentPattern,
  {fieldsMap:new Map(objectAssignmentPattern.fieldsMap)})
{
  const prop = objectAssignmentPattern.fieldsMap.get(Tag.properties)
  const elem = Object.assign({},prop.elem,{declVar:true})
  prop.elem.declVar = false
  objectPattern.fieldsMap.set(
    Tag.properties,
    Object.assign({},prop,{elem,fieldsMap:new Map([[Tag.push,elem]])}))
}
const arrayAssignmentPattern = symInfo(Tag.ArrayPattern)
const arrayPattern = Object.assign(
  {},arrayAssignmentPattern,
  {fieldsMap:new Map(arrayAssignmentPattern.fieldsMap)})
{
  const prop = arrayAssignmentPattern.fieldsMap.get(Tag.elements)
  const elem = Object.assign({},prop.elem,{declVar:true})
  prop.elem.declVar = false
  arrayPattern.fieldsMap.set(
    Tag.elements,
    Object.assign({},prop,{elem,fieldsMap:new Map([[Tag.push,elem]])}))
}
{
  assignmentPattern.fieldsMap.get(Tag.left).declVar = true
  const patField = symInfo(Tag.VariableDeclarator).fieldsMap.get(Tag.id)
  assignmentProperty.esType = "ObjectProperty"
  assignmentProperty.fieldsMap = new Map(objectProperty.fieldsMap)
  assignmentProperty.fieldsMap.set(Tag.value,patField)
  // TODO: Babel 7 has no RestProperty (remove the ifs)
  if (Tag.RestElement)
    symInfo(Tag.RestElement).fieldsMap.set(Tag.argument,patField)
  if (Tag.RestProperty)
    symInfo(Tag.RestProperty).fieldsMap.set(Tag.argument,patField)
}

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
        assert.ok(i.value.node.type)
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
  for(const i of /*require("./trace").lazy(*/s/*)*/) {
    if (i.enter) {
      let f = stack[stack.length-1]
      if (f && f.fieldsMap) {
        f = i.value.fieldInfo = f.fieldsMap.get(i.pos)
      }
      let ti = f && f.ti || typeInfo(i)
      switch(ti.kind) {
      case "array":
        stack.push(i.value.fieldInfo)
        break
      case "node":
        // babel validator hacks
        // TODO: own model description
        switch(i.type) {
        case Tag.ArrayPattern:
          ti = f && f.declVar ? arrayPattern : arrayAssignmentPattern
          break
        case Tag.ObjectPattern:
          ti = f && f.declVar ? objectPattern : objectAssignmentPattern
          break
        case Tag.AssignmentExpression:
          ti = i.value.node.operator === "="
            ? assignmentOpEq : assignmentOpDefault
          break
        case Tag.ObjectProperty:
          if (f && f.declVar)
            ti = assignmentProperty
          break
        case Tag.AssignmentPattern:
          if (!f || !f.declVar)
            ti = symInfo(Tag.AssignmentExpression)
          break
        case Tag.MemberExpression:
        case Tag.ObjectMethod:
        case Tag.ClassProperty:
        case Tag.ClassMethod:
        case Tag.ClassPrivateMethod:
        case Tag.ClassPrivateProperty:
          if (i.value.node.computed)
            ti = ti.propAlt
          break
        }
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

export function isSynthetic(node) {
  return !node || node.loc == null;
}


