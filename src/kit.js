import * as R from "ramda"
import * as assert from "assert"
import {produce,consume,Tag} from "./index"

/**
 * adds `take` function to ES6 iterators interface
 * children classes may implement one of `take` or `next` methods
 */
export class ExtIterator {
  [Symbol.iterator]() { return this }
  /**
   * ES6 Iterator interface `next`
   */
  next(v) {
    const c = this.take(v)
    return {value:c,done:c == null}
  }
  /**
   * same as `next` but returns either next value or null if done
   */
  take(v) {
    const c = this.next(v)
    return c.done ? null : c.value
  }
  constructor(cont) {
    this._cont = cont
  }
}

export class ArrayLookahead extends ExtIterator {
  constructor(cont) {
    super(cont)
    this._x = 0
    this.first = cont[0]
  }
  next(v) {
    const c = this._cont[this._x++]
    return {value:c,done:c == null}
  }
  take(v) {
    return this._cont[this._x++]
  }
  cur() {
    return this._cont[this._x]
  }
}

export class Lookahead extends ExtIterator {
  constructor(cont) {
    super(cont)
    this._inner = cont[Symbol.iterator]()
    this.first = this._cur = this._inner.next()
    
  }
  next(v) {
    const cur = this._cur
    if (!cur.done)
      this._cur = this._inner.next(v)
    return cur
  }
  cur() { return this._cur.done ? undefined : this._cur.value }
}

export const Output = (ctor,Super) => class Output extends Super {
  constructor(cont) {
    super(cont)
  }
  enter(pos,type,value) {
    [pos,type,value] = ctor(pos,type,value)
    return {enter:true,leave:false,type,pos,value}
  }
  leave(pos,type,value) {
    [pos,type,value] = ctor(pos,type,value)
    return {enter:false,leave:true,type,pos,value}
  }
  tok(pos,type,value) {
    [pos,type,value] = ctor(pos,type,value)
    return {enter:true,leave:true,type,pos,value}
  }
}

export const Scope = (Super) => class Scope extends Super {
  constructor(cont) {
    super(cont)
    this._stack = []
  }
  *_timStack(len) {
    yield* this._stack.splice(0,this._stack.length - len)
  }
  enter(pos,type,value) {
    const r = super.enter(pos,type,value)
    this._stack.unshift(super.leave(r.pos,r.type,r.value))
    return r
  }
  leave() {
    return this._stack.shift()
  }
  label() {
    const pos = this._stack.length
    const t = this
    return function*() {
      yield* t._trimStack(pos)
    }
  }
}

export function Level(Super) {
  function* one(t) {
    const c = t.cur()
    if (c == null || !c.enter)
      return
    const exit = t.level
    for(const i of t) {
      yield i
      if (exit === t.level)
        return
    }
  }
  function* sub(t) {
    const c = t.cur()
    if (c == null || !c.enter)
      return
    const exit = t.level
    for(const i of t) {
      yield i
      if (exit === t.level) {
        const c = t.cur()
        if (c == null || !c.enter)
          return
      }
    }
  }
  return class Level extends Super {
    constructor(cont) {
      super(cont)
      this.level = 0
    }
    next(v) {
      const c = super.next(v)
      if (c.done)
        return c
      // 0(1! 1(2! 2! 2(3! 3! 3!2)1)0)
      const t = c.value
      if (t.enter)
        this.level++
      if (t.leave)
        this.level--
      return c
    }
    one() { return one(this) }
    sub() { return sub(this) }
    curLev() {
      const v = this.cur()
      if (!v || !v.enter)
        return null
      return v
    }
    *untilPos(pos) {
      var i
      while((i = this.curLev()) != null && i.pos !== pos)
        yield* one(this)
      return i
    }
    *findPos(pos) {
      const i = yield* this.untilPos(pos)
      if (i != null)
        this.take()
      return i
    }
    *toPos(pos) {
      const p = yield* this.findPos(pos)
      assert.ok(p)
      yield p
      return p
    }
  }
}

export function WithPeel(Super) {
  const copyTag = {t:"copy"}
  // means we are to skip next tag from input because it is in the stack already
  const skipTag = {t:"skip"}
  // virtual close (already closed in token)
  const vCloseTag = {t:"vClose"}
  return class WithPeel extends Scope(Super) {
    constructor(cont) {
      super(cont)
    }
    *_trimStack(len) {
      const sub = this._stack.splice(0,this._stack.length - len)
      for(const i of sub)
        if (i === skipTag)
          this.take()
      else if (i !== vCloseTag) {
        yield i === copyTag ? this.take() : i
      }
    }
    *leave() {
      for(;;) {
        const f = this._stack.shift()
        switch(f) {
        case copyTag:
          yield this.take();
          break
        case vCloseTag:
          break
        case skipTag:
          this.take()
          break
        default:
          yield f
          return f
        }
      }
    }
    peel(i) {
      if (i == null) 
        i = this.take()
      assert.ok(i.enter)
      const res = this.enter(i.pos,i.type,i.value)
      this._stack.unshift(i.leave ? vCloseTag : skipTag)
      return res
    }
    *peelTo(pos) {
      assert.notEqual(this._stack[0],vCloseTag)
      const i = yield *this.findPos(pos)
      assert.ok(i);
      yield this.peel(i);
      return i
    }
    peelOpt() {
      const v = this.cur()
      if (!v || !v.enter)
        return null
      return this.peel()
    }
    *one() {
      if (this._stack[0] !== vCloseTag)
        yield* super.one(); 
    }
    *sub() {
      if (this._stack[0] !== vCloseTag)
        yield* super.sub(); 
    }
    *findPos(pos) {
      if (this._stack[0] !== vCloseTag)
        return (yield* super.findPos(pos))
      return null
    }
    *copy(i) {
      yield this.peel(i);
      yield* this.sub();
      yield* this.leave();
    }
  }
}

export function defaultCtor(pos, type, value) {
  if (value == null) {
    value = type === Tag.Array ? [] : {}
  }
  return [pos,type,value]
}

export function Stream(opts) {
  if (opts == null)
    opts = {}
  let Iterator = opts.arr ? ArrayLookahead : Lookahead
  if (!opts.ctor)
    opts.ctor = defaultCtor
  Iterator = Output(opts.ctor,Iterator)
  if (opts.scope || opts.peel || opts.level)
    Iterator = Level(Iterator)
  if (opts.scope || opts.peel)
    Iterator = Scope(Iterator)
  if (opts.peel)
    Iterator = WithPeel(Iterator)
  return Iterator
}

export function* verify(s) {
  const stack = []
  for(const i of s) {
    assert.ok(i.enter != null)
    assert.ok(i.leave != null)
    assert.ok(i.pos != null)
    assert.ok(i.type != null)
    assert.ok(i.value != null)
    if (i.enter && !i.leave)
      stack.push(i)
    if (!i.enter && i.leave) {
      const f = stack.pop()
      assert.ok(f != null)
      assert.equal(f.type,i.type)
      assert.equal(f.pos,i.pos)
      assert.equal(f.value,i.value)
    }
    yield i
  }
  assert.equal(stack.length,0)
}

export const trace = R.curry(function* trace(prefix,s) {
  let level = 0
  let x = 0
  for(const i of s) {
    if (i.enter)
      level++
    const dir = i.enter && i.leave ? "*" : i.enter ? ">" : "<"
    const clevel = s.level ? `/${s.level}` : ""
    const descr = `${prefix}:${i.pos.$}:${i.type.$}[${level}${clevel}]`
    if (i.enter && !i.leave)
      console.group(descr)
    console.log(dir,`${descr}@${x}`,i.value)
    yield i
    if (i.leave) {
      if (!i.enter)
        console.groupEnd()
      level--
    }
    x++
  }
  console.log(`${prefix}: len: ${x}`)
})

export const traceAll = R.pipe(trace,verify,Array.from)

export function skip(s) {
  for(const i of s){}
}
