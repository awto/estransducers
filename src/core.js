import {VISITOR_KEYS} from "babel-types"

let nameCount = 0

export function makeCode(name,kind) {
  return {$:name,kind,x:nameCount++}
}

export const Tag = {push:makeCode("push","pos"),
                    top:makeCode("top","pos"),
                    Array:makeCode("Array","type"),
                    Null:makeCode("Null","type")}

for(const i in VISITOR_KEYS) {
  Tag[i] = makeCode(i,"type")
  for (const j of VISITOR_KEYS[i])
    Tag[j] = makeCode(j,"pos")
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
    if (i.type == null || !Tag[i.type.$])
      continue
    if (i.enter) {
      if (i.type === Tag.Array) {
        stack.unshift(i.value.node = [])
      } else  {
        if (i.value != null)
          i.value.type = i.type.$
        stack.unshift(i.value.node)
      }
    }
    if (i.leave) {
      const value = stack.shift()
      if (i.pos === Tag.push) {
        stack[0].push(value)
      } else
        stack[0][i.pos.$] = value
    }
  }
  return res
}

export function consume(s) {
  const stack = [{}]
  for (const i of s) {
    if (i.type == null || !Tag[i.type.$])
      continue
    if (i.enter) {
      if (i.type === Tag.Array)
        stack.unshift([])
      //TODO: another step to handle nulls
      else if (i.type === Tag.Null) {
        if (i.pos !== Tag.push)
          stack[0][i.pos.$] = null
        continue
      } else {
        if (i.value != null)
          i.value.node.type = i.type.$
        stack.unshift(i.value.node)
      }
    }
    if (i.leave) {
      const node = stack.shift()
      if (i.pos === Tag.push) {
        stack[0].push(node)
      } else
        stack[0][i.pos.$] = node
    }
  }
  return stack[0]
}
