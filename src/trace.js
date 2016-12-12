import * as assert from "assert"
import generate from "babel-generator"
import * as T from "babel-types"

const MAX_TRACE_CODE_LEN = 40
const TYPE_SIZE = 20
const BROWSER_DEBUG = typeof window !== "undefined" && window.chrome === true
const enterStyles = "background: #222; color: #bada55;font-size:1.5em"
const leaveStyles = "color: #ee5757; background: black"
const newTagStyle = "color:purple;font-size:large"
const positionStyle = "color:gray;text-decoration:underline"
const dirStyle = "font-size:x-large;font-weight:bolder"

/**
  * outputs short description of AST node
  */ 
export function cg(ast, opts = {}) {
  var res
  if (ast == null) {
    // console.error("<NULL>")
    return "<NULL>"
  }
  try {
    if (Array.isArray(ast)) {
      ast = ast.length > 0 && T.isExpression(ast[0]) 
        ? T.sequenceExpression(ast)
        : T.blockStatement(ast)
    }
    res = generate(ast,opts).code
  } catch (e) {
    if (ast.type != null)
      console.error(e.stack)
  }
  if (res != null) {
    return res
  }
  return "!!" + opts.compact ? JSON.stringify(ast) : JSON.stringify(ast,null,2)
}

/**
  * same as `cg` but using compact syntax
  */
export function ccg(ast) {
  return cg(ast,{compact:true})
}

if (BROWSER_DEBUG) {
  global.cg = cg
  global.ccg = ccg
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

function pad(s) {
  if (s.length % 2)
    s += ' '
  const sps = Array(Math.max(20 - s.length/2,2)).join(' ')
  return sps + s + sps
}

function* traceImpl(prefix,s) {
  let level = 0
  let x = 0
  console.log(`%c${pad(prefix)}%c`,
              `background:#2B81AF;color:#fff;font-size:xx-large;
              text-shadow:rgba(0, 0, 0, 0.5) 2px 2px 1px`,
              "")
  for(const i of s) {
    const styles = []
    if (i.enter)
      level++
    const dir = i.enter && i.leave ? "\u21c4" : i.enter ? "\u2192" : "\u2190"
    const clevel = s.level ? `/${s.level}` : ""
    const descr = `${prefix}${i.pos.$}:${i.type.$}[${level}${clevel}]`
    if (i.enter && !i.leave && console.group != null)
      console.group(descr)
    let n = ""
    const {node} = i.value
    const comments = []
    let commentsTxt = ""
    const commentsStyle = []
    if (i.value.comments) {
      for(const j of i.obj.comments) {
        comments.push(`%c${j.txt}%c`)
        const mod = !i.enter
              ? "font-size:small;font-style:italic"
              : "font-weight:bolder"
        const s = `${j.style}${mod}`
        styles.push(s,'')
      }
      if (comments.length)
        commentsTxt = "[" + comments.join(" ") + "]"
    }
    if (node != null && i.type.$ !== "Array" && i.type.kind !== "ctrl") {
      n = ccg(node)
      if (n.length > MAX_TRACE_CODE_LEN)
        n = n.substr(0,MAX_TRACE_CODE_LEN) + "..."
      n = `%c${n}%c`
      styles.push(i.enter ? enterStyles : leaveStyles,"")
      const {loc} = node
      if (loc != null) {
        let {source:f,start:s,end:e} = loc
        n += ` %c@${f || "?"}-${s.line}:${s.column}..${e.line}:${e.column}%c`
        styles.push(positionStyle,"")
      } else {
        n += " %c@new%c"
        styles.push(newTagStyle,"")
      }
    }
    console.log(`%c${dir}%c ${descr}@${x}${commentsTxt} ${n}`,
                dirStyle,"",
                ...styles,i.value)
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

export const lazy = traceArgs(traceImpl)
export const all = traceArgs(traceAllImpl)

