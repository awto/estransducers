import * as assert from "assert"
import generate from "babel-generator"
import * as T from "babel-types"
import {Tag,symKind,symInfo,typeInfo,symName,resetFieldInfo} from "./core"
import chalk from "chalk"

const MAX_TRACE_CODE_LEN = 40
const TYPE_SIZE = 20
export const BROWSER_DEBUG = typeof window !== "undefined" && window.chrome
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
    res = generate(ast,opts,"").code
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
  for(const i of resetFieldInfo(s)) {
    assert.ok(i.enter != null)
    assert.ok(i.leave != null)
    assert.ok(i.pos != null)
    assert.ok(i.type != null)
    assert.ok(i.value != null)
    const ti = typeInfo(i)
    const ctrlPos = symInfo(i.pos).kind === "ctrl"
    if (i.enter && stack.length) {
      const [f,keys] = stack[stack.length-1]
      if (f.type === Tag.Array) {
        if (!ctrlPos)
          assert.equal(i.pos, Tag.push)
      } else if (keys != null && !ctrlPos) {
        let k
        while((k = keys.shift()) != null) {
          if (Tag[k] === i.pos)
            break
        }
        assert.ok(k,"field name exists")
      }
    }
    if (i.enter && i.value.fieldInfo != null) {
      if (i.type === Tag.Array) {
        assert.ok(i.value.fieldInfo.array,"expected array field")
      } else if (ti.kind === "node") {
      }
    }
    if (i.enter && !i.leave) {
      const keys = T.VISITOR_KEYS[symName(i.type)]
      stack.push([i,keys && [...keys]])
    }
    if (!i.enter && i.leave) {
      const [f] = stack.pop()
      assert.ok(f != null)
      if (ti.kind !== "ctrl")
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

const traceImpl = BROWSER_DEBUG ? browserTraceImpl : traceNodeImpl

function* traceNodeImpl(prefix, s) {
  let level = 0
  let x = 0
  for(const i of s) {
    if (i.enter)
      level++
    const dir = chalk.bold(i.leave ? (i.enter ? "|" : "/") : "\\")
    
    const clevel = s.level ? `/${s.level}` : ""
    const descr = `${chalk.green(symName(i.pos))}:${
           i.type.ctrl ? chalk.green(symName(i.type)) 
                       : chalk.green.bold(symName(i.type))
        }[${level}${clevel}]`
    let n = ""
    const {node} = i.value
    const comments = []
    let commentsTxt = ""
    const t = [].concat(i.value.comments || [], i.value.tcomments || [])
    if (t.length) {
      for(const j of t) {
        let c = j.txt
        c = !i.enter(chalk.dim(j.txt)) || j.txt
      }
      if (comments.length)
        commentsTxt = chalk.bold("[") + comments.join(" ") + chalk.bold("]")
    }
    if (node != null && i.type !== Tag.Array && symKind(i.type) !== "ctrl") {
      n = ccg(node)
      if (n.length > MAX_TRACE_CODE_LEN)
        n = n.substr(0,MAX_TRACE_CODE_LEN) + "..."
      n = chalk.yellow(n)
      const {loc} = node
      if (loc != null) {
        let {source:f,start:s,end:e} = loc
        n += chalk.blue(` @${f || "?"}-${s.line}:${s.column}..${e.line}:${e.column}`)
      } else {
        n += chalk.bold(" @new")
      }
    }
    console.log(
      prefix,
      Array(level).join(' '),
      dir,`${descr}@${x}`,
      commentsTxt, n)
    yield i
    if (i.leave) {
      level--
    }
    x++
  }
  console.log(prefix,"len:",x)
}

function* browserTraceImpl(prefix,s) {
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
    const tp = i.pos === i.type ? symName(i.type)
          :`${symName(i.pos)}:${symName(i.type)}`
    const descr = `${prefix}${tp}[${level}${clevel}]`
    let ldescr
    if (i.pos === i.type) {
      ldescr = `${prefix}%c${symName(i.type)}%c[${level}${clevel}]`
      styles.push(symKind(i.type) === "ctrl"
                  ? "color:navy;font-size:large"
                  : "color:steelblue",
                  "")
    } else {
      ldescr = `${prefix}%c${symName(i.pos)}:%c${
        symName(i.type)}%c[${level}${clevel}]`
      styles.push(symKind(i.pos) === "ctrl"
                  ? "color:olive;font-size:large"
                  : "color:green")
      styles.push(symKind(i.type) === "ctrl"
                  ? "color:navy;font-size:large"
                  : "color:steelblue",
                  "")
    }
    if (i.enter && !i.leave && console.group != null) {
      if (x === 0 && i.value.collapsed !== false || i.value.collapsed)
        console.groupCollapsed(descr)
      else
        console.group(descr)
    }
    let n = ""
    const {node} = i.value
    const comments = []
    let commentsTxt = ""
    const commentsStyle = []
    const t = [].concat(i.value.comments || [], i.value.tcomments || [])
    if (t.length) {
      const pstyle = "color:green;font-size:large"
      styles.push(pstyle)
      for(const j of t) {
        comments.push(`%c${j.txt}%c`)
        const mod = !i.enter
              ? "font-size:small;font-style:italic"
              : "font-weight:bolder;font-size:large"
        const s = `${j.style || ''}${mod}`
        styles.push(s,"")
      }
      if (comments.length) {
        commentsTxt = "%c[" + comments.join(" ") + "%c]%c"
        styles.push(pstyle,"")
      }
    }
    if (node != null && i.type !== Tag.Array && symKind(i.type) !== "ctrl") {
      n = ccg(node)
      if (n.length > MAX_TRACE_CODE_LEN)
        n = n.substr(0,MAX_TRACE_CODE_LEN) + "..."
      n = `%c ${n} %c`
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
    console.log(`%c${dir}%c ${ldescr}@${x}${commentsTxt} ${n}`,
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

export function* cleanComments(s) {
  for(const i of s) {
    if (i.enter)
      i.value.comments = []
    yield i
  }
}

export function* setSymComments(s) {
  for(const i of s) {
    if (i.enter && i.value.sym && i.value.sym.id) {
      const c = i.value.comments || (i.value.comments = [])
      c.push({txt:i.value.sym.id})
    }
    yield i
  }
}

export const lazy = traceArgs(traceImpl)
export const all = traceArgs(traceAllImpl)
export default lazy

