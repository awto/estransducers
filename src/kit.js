import * as R from "ramda"
import * as assert from "assert"
import {produce,consume,Tag,enter,leave,tok,makeTag} from "./core"
import * as T from "babel-types"
import {parse} from "babylon"

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
  take(v) {
    const cur = this._cur
    if (cur.done)
      return null
    this._cur = this._inner.next(v)
    return cur.value
  }
  cur() { return this._cur.done ? undefined : this._cur.value }
}

const ctrlTok = {$:"ctrlTok",kind:"ctrl"}
const ctrlTokGen = {$:"ctrlTokGen",kind:"ctrl"}
const storedTok = {$:"storedTok",kind:"ctrl"}

export const Output = (Super) => class Output extends Super {
  constructor(cont) {
    super(cont)
    this._stack = []
  }
  valCtor (pos,type,value) {
    let node = null
    if (value == null) { 
      value = {}
      if (type != null && type.$ == null) {
        if (type.node != null) {
          value = type
          node = value.node
          type = null
        } else if (type.type != null) {
          node = type
          value = {node}
          type = null
        }
      }
    } else
      node = value.node
    if (type == null && node != null && node.type != null) {
      type = Tag[node.type]
    }
    if (type == null)
      type = pos
    if (node == null) {
      value.node = node =
        type === Tag.Array ? [] : type === Tag.Null ? null : {}
    }
    return [pos,type,value]
  }
  *toks(pos,node) {
    yield* toks(pos,node)
  }
  enter(pos,type,value) {
    [pos,type,value] = this.valCtor(pos,type,value)
    this._stack.unshift({$:storedTok,
                         tok:{enter:false,leave:true,
                              pos:pos,type:type,value:value}})
    return {enter:true,leave:false,type,pos,value}
  }
  tok(pos,type,value) {
    [pos,type,value] = this.valCtor(pos,type,value)
    return {enter:true,leave:true,type,pos,value}
  }
  *leave() {
    let f
    while((f=this._stack.shift())) {
      switch(f.$) {
      case ctrlTok:
        f.run(this)
        break
      case ctrlTokGen:
        yield* f.run(this)
        break
      default:
        yield f.tok
        return f.tok
      }
    }
  }
  label() {
    const pos = this._stack.length
    const t = this
    return function*() {
      const sub = t._stack.splice(0,t._stack.length - pos)
      for(const i of sub) {
        switch(i.$) {
        case ctrlTok:
          i.run(t)
          break
        case ctrlTokGen:
          yield* i.run(t)
          break
        default:
          yield i.tok
        }
      }
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
      const t = c.value
      if (t.enter)
        this.level++
      if (t.leave)
        this.level--
      return c
    }
    take(v) {
      const c = super.take(v)
      if (c == null)
        return c
      if (c.enter)
        this.level++
      if (c.leave)
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
  const copyTag = {$:ctrlTokGen,*run(t){yield t.take();},t:"copy"}
  // means we are to skip next tag from input because it is in the stack already
  const skipTag = {$:ctrlTok,run(t) { t.take(); },t:"skip"}
  // virtual close (already closed in token)
  const vCloseTag = {$:ctrlTok,run() {},t:"close"}
  return class WithPeel extends Super {
    constructor(cont) {
      super(cont)
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

const memo = new Map()

export function* toks(pos,s) {
  if (Array.isArray(s))
    yield* clone(s)
  if (s.substr != null) {
    let r = memo.get(s)
    if (r == null) {
      let expr = false, list = false
      if (s[0] === "=") {
        expr = true
        s = s.slice(1)
      } else if (s[0] === "*") {
        list = true
        s = s.slice(1)
      }
      const b = parse(s)
      assert.equal(b.type, "File")
      assert.equal(b.program.type, "Program")
      if (!list)
        assert.equal(b.program.body.length, 1)
      if (expr) {
        assert.equal(b.program.body[0].type, "ExpressionStatement")
        r = b.program.body[0].expression
      } else if (list) {
        r = b.program.body
      } else {
        r = b.program.body[0]
      }
      memo.set(s,r)
    }
    s = r
  }
  if (Array.isArray(s)) {
    for(const i of s)
      yield* clone(produce(i,pos))
    
  } else
    yield* clone(produce(s,pos))
}

export function Template(Super) {
  const templateTok = {$:ctrlTokGen,
                       *run(t) {
                         yield* t._tstack.shift()
                       }}
  return class Template extends Super {
    constructor(cont) {
      super(cont)
      this._tstack = []
    }
    template(pos,node) {
      if (node.substr != null)
        node = toArray(toks(pos,node))
      this._stack.unshift(templateTok)
      this._tstack.unshift(node)
    }
    *open() {
      const arr = this._tstack[0]
      while(arr.length) {
        const f = arr.shift()
        if (f.enter) {
          switch(f.type) {
          case Tag.ExpressionStatement:
            const n = arr[0]
            if (n != null
                && n.type === Tag.Identifier
                && n.value.node.name === "$$")
            {
              while(arr.length && arr.shift().value !== f.value) {}
              return f.pos
            }
            break
          case Tag.Identifier:
            if (f.type === Tag.Identifier) {
              const n = f.value.node.name
              if (n === "$$" || n === "$E") {
                while(arr.length && arr.shift().value !== f.value) {}
                return f.pos
              }
            }
            break
          }
        }
        yield f
      }
      throw new Error("next placeholder is not found")
    }
  }
}

export function Stream(opts) {
  if (opts == null)
    opts = {}
  let Iterator = opts.arr ? ArrayLookahead : Lookahead
  if (opts.peel || opts.level)
    Iterator = Level(Iterator)
  if (opts.template || opts.output || opts.peel)
    Iterator = Output(Iterator)
  if (opts.peel)
    Iterator = WithPeel(Iterator)
  if (opts.template)
    Iterator = Template(Iterator)
  return Iterator
}

export const LookaheadArrStream = Stream({arr:true})
export const LookaheadStream = Stream({})
export function lookahead(s) {
  // return Array.isArray(s) ? new LookaheadArrStream(s) : new LookaheadStream(s)
  return new LookaheadStream(s)
}

export const LevelStream = Stream({level:true})
export const LevelArrStream = Stream({level:true,arr:true})
export function levels(s) {
  //  return Array.isArray(s) ? new LevelStream(s) : new LevelArrStream(s)
  return new LevelStream(s)
}

export const AutoStream = Stream({peel:true,template:true})
export const AutoArrStream = Stream({peel:true,template:true,arr:true})
export function auto(s) {
  //  return Array.isArray(s) ? new AutoArrStream(s) : new AutoStream(s)
  return new AutoStream(s)
}


export class NoInput {}
export const OutputStream = Template(Output(NoInput))
export function output(s) {
  return new OutputStream(s)
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

function* traceImpl(prefix,s) {
  let level = 0
  let x = 0
  for(const i of s) {
    if (i.enter)
      level++
    const dir = i.enter && i.leave ? "*" : i.enter ? ">" : "<"
    const clevel = s.level ? `/${s.level}` : ""
    const descr = `${prefix}${i.pos.$}:${i.type.$}[${level}${clevel}]`
    if (i.enter && !i.leave && console.group != null)
      console.group(descr)
    console.log(dir,`${descr}@${x}`,i.value)
    yield i
    if (i.leave) {
      if (!i.enter && console.group != null)
        console.groupEnd()
      level--
    }
    x++
  }
  console.log(`${prefix}: len: ${x}`)
}

function traceAllImpl(prefix,s) {
  return [...verify(traceImpl(prefix,s))] 
}

function traceArgs(impl) {
  return function traceImpl(prefix,s) {
    if (prefix == null || prefix.substr == null) {
      if (s == null)
        s = prefix
      prefix = ""
    }
    if (prefix.length)
      prefix += ":"
    if (s == null || s[Symbol.iterator] == null)
      return (s) => impl(prefix,s)
    return impl(prefix,s)
  }
}

export const trace = traceArgs(traceImpl)
export const traceAll = traceArgs(traceAllImpl)

export function skip(s) {
  for(const i of s){}
}

/**
  * modifies token replacing its `type` field
  */
export function setType(i,type) {
  return {enter:i.enter,leave:i.leave,type,pos:i.pos,value:i.value}
}

/**
  * modifies token replacing its `pos` field
  */
export function setPos(i,pos) {
  return {enter:i.enter,leave:i.leave,type:i.type,pos,value:i.value}
}

export const Subst = {$:"Subst",kind:"ctrl"}

export function* completeSubst(s) {
  const sl = auto(s)
  function* subst(pos) {
    for(const i of sl.sub()) {
      if (i.type === Subst) {
        if (i.enter)
          yield* subst(i.pos)
      } else {
        yield sl.peel(setPos(i,pos))
        yield* walk()
        yield* sl.leave()
      }
    }
  }
  function* walk() {
    for(const i of sl.sub()) {
      if (i.type === Subst) {
        if (i.enter) {
          assert.ok(!i.leave)
          yield* subst(i.pos)
        }
      } else
        yield i
    }
  }
  yield* walk()
}

export function toArray(s) {
  return Array.isArray(s) ? s : Array.from(s)
}

export function result(s,buf) {
  const i = s[Symbol.iterator]()
  for(;;){
    const v = i.next()
    if (v.done)
      return v.value
    buf.push(v.value)
  }
}


ExtIterator.prototype.tillLevel = function(level) {
  return tillLevel(level,this)
}
/**
 * values until leaving specified level
 */
export function* tillLevel(level,s) {
  for(const i of s) {
    yield i
    if (i.leave && s.level === level)
      return
  }
}

export function* toBlockBody(s) {
  const lab = s.label()
  const i = s.cur()
  if (i.type === Tag.BlockStatement) {
    s.peel()
    skip(s.peelTo(Tag.body))
    return function*() {
      skip(lab())
    }
  } else {
    yield s.enter(Tag.push,Subst)
    return lab
  }
}

export function* inBlockBody(s,inner) {
  const lab = s.label()
  const i = s.cur()
  if (i.type !== Tag.BlockStatement) {
    yield s.enter(Tag.push,Subst)
    yield* inner
    yield* lab()
  } else {
    s.peel()
    skip(s.peelTo(Tag.body))
    yield* inner
    skip(lab())
  }
}

export const transform = R.curry(function babelVisitor(pass,ast) {
  return consume(pass(produce(ast))).top
})

/**
 * babel plugin visitor methods, typically to be applied only to Program node
 */
export const babelBridge = R.curry(function babelBridge(pass,path) {
  
    consume(pass(produce(path.node)))
})

export function hasAnnot(node,name) {
  return node.leadingComments
    && node.leadingComments.length
    && node.leadingComments.find(v => v.value.trim() === name) !== undefined
}

export function* clone(s) {
  const stack = []
  for(const i of s) {
    let value = null
    if (i.enter) {
      stack.push(value = Object.assign({},i.value))
      const isArray = value.isArray = i.type === Tag.Array
      if (isArray)
        value.node = value.node.concat()
      else if (value.node != null && Tag[i.type.$] != null) {
        value.node = Object.assign({},value.node)
        if (value.node.leadingComments != null)
          value.node.leadingComments = value.node.leadingComments.concat()
        if (value.node.trealingComments != null)
          value.node.trealingComments = value.node.trealingComments.concat()
      }
    }
    if (i.leave)
      value = stack.pop()
    yield {enter:i.enter,leave:i.leave,type:i.type,pos:i.pos,value}
  }
}

function* till(pred, s) {
  for(const i of s) {
    yield i
    if (pred(i))
      return i
  }
}
ExtIterator.prototype.till = function(pred) { return till(pred,this); }

export const find = R.curry(function* find(pred, s) {
  if (pred(s.cur()))
    return true
  for(const i of s) {
    if (pred(s.cur()))
      return true
    yield i
  }
})
ExtIterator.prototype.find = function(pred) { return find(pred,this); }

