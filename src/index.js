import {VISITOR_KEYS} from "babel-types"

export const Tag = {push:{$:"push"},top:{$:"top"},Array:{$:"Array"},Null:{$:"Null"}}

for(const i in VISITOR_KEYS) {
  Tag[i] = {$:i}
  for (const j of VISITOR_KEYS[i])
    Tag[j] = {$:j}
}


function isNode(node) {
  if (node == null)
    return false;
  return typeof node === 'object' && typeof node.type === 'string';
}

export function* produce(node,pos) {
  function* walk(value,pos) {
    if (Array.isArray(value)) {
      const data = {}
      yield {enter: true, leave: false, value, pos, type: Tag.Array,data}
      for(const i of value)
        yield* walk(i,Tag.push)
      yield {enter: false, leave: true, value, pos, type: Tag.Array,data}
    } else if (isNode(value)) {
      const keys = VISITOR_KEYS[value.type]
      const type = Tag[value.type]
      if (keys.length) {
        const data = {}
        yield {enter: true, leave: false, value, pos, type, data}
        for(const i of keys) {
          const v = value[i]
          if (v != null)
            yield* walk(value[i],Tag[i] || i)
        }
        yield {enter: false, leave: true, value, pos, type, data}
      } else {
        yield {enter: true, leave: true, value, pos, type, data: {}}
      }
    }
  }
  yield* walk(node,pos || Tag.top)
}

export function consume(s) {
  const stack = [{}]
  for (const i of s) {
    if (i.type == null || !Tag[i.type.$])
      continue
    if (i.enter) {
      if (i.type === Tag.Array)
        stack.unshift([])
      else  {
        if (i.value != null)
          i.value.type = i.type.$
        stack.unshift(i.value)
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
  return stack[0]
}

