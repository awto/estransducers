import {produce,consume,Tag} from "../core"
import * as Kit from "../kit"
import * as R from "ramda"
import * as T from "babel-types"
import * as assert from "assert"
import * as Match from "../match"

export default R.pipe(
  Match.inject(`for($$ of $$) $$`),
  function eagerForOfTransform(si) {
    const s = Kit.auto(si)
    function* walkDecls(decls,txt) {
      const c = decls[0]
      if (c.type === Tag.VariableDeclaration) {
        yield s.enter(Tag.push,Kit.Subst)
        for(const j of decls) {
          if (j.leave && j.type === Tag.VariableDeclarator) {
            yield* s.toks(Tag.init,txt)
          }
          yield j
        }
      } else {
        yield s.enter(Tag.push,Tag.ExpressionStatement)
        yield s.enter(Tag.expression,Tag.AssignmentExpression,
                      {node:{operator:"="}})
        yield s.enter(Tag.left,Kit.Subst)
        yield* decls
        yield* s.leave()
        yield* s.toks(Tag.right,txt)
        yield* s.leave()
      }
      yield* s.leave()
    }
    function* walk(label) {
      for(const i of s.sub()) {
        switch(i.type) {
        case Match.Root:
          if (i.enter) {
            Kit.skip(s.till(v => v.enter && v.type === Match.Placeholder))
            const decls = [...s.sub()]
            Kit.skip(s.till(v => v.enter && v.type === Match.Placeholder))
            const init = [...s.sub()]
            Kit.skip(s.till(v => v.enter && v.type === Match.Placeholder))
            const blab = s.label()
            const body = [...Kit.inBlockBody(s,walk())]
            Kit.skip(s.till(v => v.leave && v.type === Match.Root))
            const lab = s.label()
            s.template(Tag.push,`
             {
               const _e = $$;
               const _arr = e$y$arr(_e);
               if (_arr != null) {
                  const _len = _arr.length;
                  $$: for(let _i = 0; _i < _len; ++_i) {
                    $$;
                    $$;
                  }
               } else {
                 const _iter = _e[Symbol.iterator]()
                 $$: for(let _i = _iter.next(); !_i.done; _i = _iter.next()) {
                   $$;
                   $$;
                 }
               }
             }`)
            yield* s.open()
            yield s.enter(Tag.init,Kit.Subst)
            yield* init
            yield* s.leave()
            yield* s.open()
            yield s.tok(Tag.label,label == null ? Tag.Null : T.identifier(label))
            yield* s.open()
            yield* walkDecls(decls,"=_arr[_i]")
            yield* s.open()
            yield* body
            yield* s.open()
            yield s.tok(Tag.label,label == null ? Tag.Null : T.identifier(label))
            yield* s.open()
            yield* walkDecls([...Kit.clone(decls)],"=_i.value")
            yield* s.open()
            yield* Kit.clone(body)
            yield* lab()
          }
          continue
        case Tag.LabeledStatement:
          const lab = s.label()
          const buf = [s.peel(i),...s.one()]
          if (s.cur().type === Match.Root) {
            yield* walk(i.value.node.label.name)
            Kit.skip(lab())
          } else {
            yield* buf
            yield* walk()
            yield* lab()
          }
          continue
        }
        yield i
      }
    }
    return walk()
  },
  function removeEmptyLabels(si) {
    const s = Kit.auto(si)
    function* walk() {
      for(const i of s.sub()) {
        if (i.enter && i.type === Tag.LabeledStatement
            && s.cur().type === Tag.Null)
        {
          s.peel(i)
          Kit.skip(s.one())
          yield s.enter(i.pos,Kit.Subst)
          yield* walk()
          yield* s.leave()
          Kit.skip(s.leave())
          continue
        }
        yield i
      }
    }
    return walk()
  },
  Kit.completeSubst
)
