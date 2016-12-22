import {VISITOR_KEYS} from "babel-types"

let nameCount = 0

const symbols = {}

export function symInfo(sym) {
  return symbols[sym]
}

export function symName(sym) {
  return symbols[sym].name
}

export function symKind(sym) {
  return symbols[sym].kind
}

export function symbol(name,kind) {
  const res = Symbol(name)
  symbols[res] = {name,kind,x:nameCount++}
  return res
}

export const Tag = {push:symbol("push","pos"),
                    top:symbol("top","pos"),
                    Array:symbol("Array","type"),
                    Null:symbol("Null","type")}

for(const i in VISITOR_KEYS) {
  Tag[i] = symbol(i,"type")
  for (const j of VISITOR_KEYS[i])
    Tag[j] = symbol(j,"pos")
}

for(const i in Tag) {
  Tag[Tag[i]] = Tag[i]
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
      const type = Tag[node.type]
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
          i.value.type = Symbol.keyFor(i.type)
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
    if (i.type == null || !Tag[i.type])
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
        if (i.value != null)
          i.value.node.type = symName(i.type)
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
