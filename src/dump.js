import * as R from "ramda"
import * as Kit from "./kit"
import * as Trace from "./trace"
import {Tag,produce,symName,consume,symInfo,
        resetFieldInfo,typeInfo,removeNulls} from "./core"
import * as fs from "fs"
import generate from "babel-generator"
import * as assert from "assert"
import * as T from "babel-types"

const BROWSER_DEBUG = Trace.BROWSER_DEBUG

export function* markNodeType(s) {
  for(const i of s) {
    if (i.enter) {
      const ti = typeInfo(i)
      if(ti.kind === "ctrl")
        (i.value.comments || (i.value.comments = []))
        .unshift({txt:symName(i.type),style:styles.nodetype})
      else if (i.value.comments != null && i.value.comments.length) {
        (i.value.comments || (i.value.comments = []))
          .unshift({txt:symName(i.type).match(/[A-Z]/g).join(""),
                    style:styles.nodetype})
      }
    }
    yield i
  }
}

export const convertCtrl = R.pipe(
  resetFieldInfo,
  markNodeType,
  function convertCtrl(s) {
    s = Kit.auto(s)
    let varDeclNum = 0
    function* walk(sw) {
      let last = null
      for(const i of sw) {
        if (i.enter) {
          const fld = i.value.fieldInfo || {}, ti = typeInfo(i)
          if (i.type !== Tag.Array && ti.kind === "ctrl") {
            s.peel(i)
            const lab = s.label()
            let pos = i.pos
            const nm = ti.name
            if (fld.block || fld.stmt || fld.expr) {
              yield s.enter(i.pos,
                            fld.expr ? Tag.SequenceExpression : Tag.BlockStatement,
                            {comments:i.value.comments})
              yield s.enter(fld.expr ? Tag.expressions : Tag.body,Tag.Array)
              for(;;) {
                const j = s.curLev()
                if (j == null)
                  break
                yield s.enter(Tag.push,fld.expr ? Kit.makeExpr : Kit.makeStmt)
                yield* walk(s.one())
              }
              yield* lab()
            } else {
              let j = s.curLev()
              if (j != null) {
                setComment(j,"<","nodetype")
                copyComment(i,j)
                let num = 0
                last = j
                if (!i.leave) {
                  for(;j!=null;j=s.curLev()) {
                    num++
                    yield* walk(s.one())
                    last = j
                  }
                  if (num !== 1) {
                    setEndComment(last,"/"+nm,"nodetype")
                  }
                }
              } else {
                if (last != null)
                  setEndComment(last,">"+nm,"nodetype")
              }
            }
            Kit.skip(s.leave())
            continue
          }
        }
        yield i
        last = i
      }
    }
    return walk(s)
  },
  Kit.makeExprPass
)

export const color = BROWSER_DEBUG
  ? function* color(s) {
      for(const i of s) {
        if (i.enter && i.value.comments) {
          for (const j of i.value.comments) {
            if (j.style != null && typeInfo(i).kind === "node") {
              j.txt = `%c${j.txt}%c`
              j.args = [j.style,""]
            }
          }
        }
        if (i.leave && i.value.tcomments) {
          for (const j of i.value.tcomments) {
            if (j.style != null && typeInfo(i).kind === "node") {
              j.txt = `%c${j.txt}%c`
              j.args = [j.style,""]
            }
          }
        }
        yield i
      }
  } : s => s

function* getArgs(s) {
  for(const i of s) {
    if (i.enter && i.value.comments) {
      for(const j of i.value.comments) {
        if (j.args)
          for(const k of j.args)
            yield k
      }
    }
    if (i.leave && i.value.tcomments) {
      for(const j of i.value.tcomments) {
        if (j.args)
          for(const k of j.args)
            yield k
      }
    }
  }
}

function* applyComments(s) {
  for(const i of s) {
    const node = i.value.node
    if (i.enter && node != null) {
      if (i.value.comments != null && i.value.comments.length) {
        (node.leadingComments || (node.leadingComments = []))
          .push({type:"CommentBlock",
                 value:i.value.comments.map(v => v.txt).join("|")})
      }
      if (i.value.tcomments != null && i.value.tcomments.length) {
        (node.trailingComments || (node.trailingComments = []))
          .push({type:"CommentBlock",
                 value:i.value.tcomments.map(v => v.txt).join("|")})
      }
    }
    yield i
  }
}

export const toConsole = R.curry(function toConsole(tag,s) {
  if (BROWSER_DEBUG)
    console.group(`dump %c${tag}`,"color:orange;font-size:large")
  else
    console.log(`dump ${tag}`)
  const col = R.pipe(convertCtrl,
                     color,
                     Array.from,
                     applyComments,
                     Array.from
                    )(s)
  const args = Array.from(getArgs(col))
  consume(col)
  console.log(generate(col[0].value.node).code,...args)
  if (BROWSER_DEBUG)
    console.groupEnd()
})


export const fin = R.pipe(
  removeNulls,
  convertCtrl,
  Array.from,
  applyComments,
  Array.from)

export function toStr(s) {
  consume(fin(s))
  return generate(fin[0].value.node).code
}

export default R.curry(function dump(tag,s) {
  const sa = Kit.toArray(s)
  const sl = Kit.auto(Kit.clone(sa))
  const opts = sl.opts || {}
  let dest
  if (BROWSER_DEBUG) {
    dest = "console"
  } else {
    dest = `dump-${tag}.js`
    if (opts.dump)  {
      if (opts.dump.substr) {
        if (opts.dump === "console") {
          dest = opts.dump
        } else {
          dest = opts.dump + dest
        }
      } else {
        const s = opts.dump[tag]
        if (s == null && s.substr) {
          dest = s
        }
      }
    }
  }
  if (dest === "console") {
    toConsole(tag,sl)
  } else {
    fs.writeFileSync(dest,toStr(sl))
  }
  return sa
})

export function setComment(i, txt, style = "none") {
  style = style.substr && styles[style] || style;
  (i.value.comments || (i.value.comments = [])).push({txt,style})
  return i
}

export function setEndComment(i, txt, style = "none") {
  style = style.substr && styles[style] || style;
  (i.value.tcomments || (i.value.tcomments = [])).push({txt,style})
  return i
}

export function copyComment(f,t) {
  if (f.value.comments != null)
    (t.value.comments || (t.value.comments = [])).push(...f.value.comments)
  if (f.value.tcomments != null)
    (t.value.tcomments || (t.value.tcomments = [])).push(...f.value.tcomments)
  return t
}

export function* cleanComments(s) {
  for(const i of s) {
    yield i
    if (i.leave) {
      i.value.comments = null
      i.value.tcomments = null
    }
  }
}

const styles = {
  large: "font-size:xx-large;color:orange",
  small: "font-size:large;color:navy;",
  nodetype: "font-size:xx-small;color:green;font-weight:bolder",
  none: ""
}
