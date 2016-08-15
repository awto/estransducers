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

