import {VisitorKeys} from "estraverse"

function isNode(node) {
  if (node == null)
    return false;
  return typeof node === 'object' && typeof node.type === 'string';
}

export function* produce(node,pos) {
  function* walk(value,pos) {
    if (Array.isArray(value)) {
      yield {enter: true, leave: false, value, pos}
      for(let i = 0; i < value.length; ++i)
        yield* walk(value[i],i)
      yield {enter: false, leave:true, value, pos}
    } else if (isNode(value)) {
      const keys = VisitorKeys[value.type]
      if (keys.length) {
        yield {enter: true, leave: false, value, pos}
        for(let i of keys)
          yield* walk(value[i],i)
        yield {enter: false, leave: true, value, pos}
      } else {
        yield {enter: true, leave: true, value, pos}
      }
    } else {
      yield {enter: true, leave: true, value, pos}
    }
  }
  yield* walk(node,pos)
}

export function consume(s) {
  const stack = [{keys:["result"],x:0,value:{}}]
  var cnt = 100
  for (let i of s) {
    if (i.enter) {
      const {keys, x, value} = stack[0]
      if (keys && x >= keys.length)
        throw new Error("more fields than expected")
      if (isNode(i.value)) {
        const keys = VisitorKeys[i.value.type]
        if (keys)
          stack.unshift({value: i.value, keys, x: 0})
        else
          continue
      } else if (Array.isArray(i.value))
        stack.unshift({value: i.value, keys: false, x: 0})
      else
        stack.unshift({value:i.value})
    }
    if (i.leave) {
      if (isNode(i.value) && !VisitorKeys[i.value.type])
        continue
      const s = stack.shift()
      const {x,keys,value} = stack[0]
      value[keys ? keys[x] : x] = i.value
      stack[0].x = x + 1
      if (!stack.length) 
        throw new Error("invalid input stream")
      if (s.keys && s.keys.length !== s.x) {
        throw new Error("less fields than expected")
      }
    }
  }
  if (stack.length !== 1)
    throw new Error("invalid input stream")
  return stack[0].value.result
}

