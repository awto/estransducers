import {VISITOR_KEYS} from "babel-types"

let nameCount = 0

export function makeTag(name,kind) {
  return {$:name,kind,x:nameCount++}
}

export const Tag = {push:makeTag("push","pos"),
                    top:makeTag("top","pos"),
                    Array:makeTag("Array","type"),
                    Null:makeTag("Null","type")}

for(const i in VISITOR_KEYS) {
  Tag[i] = makeTag(i,"type")
  for (const j of VISITOR_KEYS[i])
    Tag[j] = makeTag(j,"pos")
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
      else  {
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


/**
 * shares single iterator between several uses
 */
export function share(s) {
  const i = s[Symbol.iterator]()
  return {
    [Symbol.iterator] () {
      return {
        next(v) {
          return i.next(v)
        }
      }
    }
  }
}

/** 
 * iterators wrapper keeping a single element lookahead, which may be accessed
 * with `lookahead` property
 *
 * the iterator may be shared like the one returned from `share`
 */
export function lookahead(s) {
  const i = s[Symbol.iterator]()
  return {
    lookahead: i.next(),
    [Symbol.iterator] () {
      return {
        next: (v) => {
          const cur = this.lookahead
          if (cur.done)
            return cur
          this.lookahead = i.next(v)
          return cur
        }
      }
    }
  }
}

/**
 * iterator for current level sequence, takes `lookahead` iterable
 */
export function* sub(s) {
  const {lookahead} = s
  if (lookahead.done)
    return
  const {value} = lookahead
  if (value.leave)
    return
  const exit = value.level-1
  for(const i of s) {
    yield i
    if (s.lookahead.done || s.lookahead.value.level === exit)
      return
  }
}

/**
 * like `sub` but for reversed iterator
 */
export function* rsub(s) {
  const {lookahead} = s
  if (lookahead.done)
    return
  const {value} = lookahead
  if (value.enter)
    return
  const exit = value.level-1
  for(const i of s) {
    yield i
    if (s.lookahead.done || s.lookahead.value.level === exit)
      return
  }
}

/**
 * resets level field field of value, to current value,
 * it must be reapplied after each structure change
 */
export function* resetLevel(s) {
  let level = 0
  for(const i of s) {
    if (i.enter)
      level++
    i.level = level
    yield i
    if (i.leave)
      level--
  }
}

/** 
 * consumes and passes further all element till exit from the
 * current level (including the exit token)
 */
export function* tillEnd(s) {
  let level = null
  for(const i of s) {
    yield i
    if (i.enter) {
      if (level == null)
        level = i.level
    }
    if (i.leave) {
      if (level == null || level > i.level)
        return
    }
  }
}

/**
 * leaves all items un-amended until (and including) an item where 
 * `pred` is true
 */
export function* till(pred, s) {
  for(const i of s) {
    yield i
    if (pred(i))
      return true
  }
  return false
}

