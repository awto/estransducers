# estree-transducers

Transducers as alternative to visitors for ESTree AST traversal.

## Transducers in JavaScript

The primary goal of transducers is to run a pipeline of transformations of an input
stream of values without creating intermediate values. The functions describing
computations are decoupled, so this makes program design cleaner and easier
to develop and maintain.

Such decoupled design probably became popular in JavaScript after jquery
library. Similar tools have been implemented by other libraries and
became popular too. Here is an example of separating two computations with
[jquery map function](https://api.jquery.com/map/):

```
store(produce().map(f).map(g))
```

In the example `produce` may read some big file and store read values in a
jQuery object. While `store` stores computed values into another file.
Each function may either remove or add several new elements to the collection.
First it runs `f` function over the whole collection and store intermediate
result in memory, and after it runs `g` over it and again intermediate result
is in memory, and only after the final result is stored into file. For big or
probably even infinite streams this is clearly not acceptable.

The task is often occurring and there are many solutions. For example
nodejs streams and `pipe` operation adding stream transformer to some other
stream. Or Clojure transducers (different to the ones used in the library)
with a few ports to JS, like
[transducers-js](https://github.com/cognitect-labs/transducers-js)
or in [Ramda](http://ramdajs.com/).

Clojure transducers transform consumers (called reducing function in clojure),
while transducers for this library transform producers, and this is a fundamental
difference making these transducers easier to define and use in JS. Making
and combining transducers became a plain JS programming task, no needs to study
other libraries interfaces protocols. Many parts of JS may be utilized here, like
ES6 generators functions, or different control statements,
etc.

Here is an example of transducer mapping stream values.

```javascript

function map(fun) {
  return function*(input) {
    for(const i of input) {
      yield fun(i)
    }
  }
}
```

It is different to jquery map since it cannot remove or replace a single element
with a few but it is pretty obvious how to create similar trivial transducers
for these tasks. It is not required to make generic transducers at all. It may
be some specific ones implementing the concrete task. It just reads one or several
input iterators with `for-of` or with `next`, calculates something, stores current
state in local variables, and sends output values with `yield` expression. It is
still easy to compose it with some other transducers doing another part of the job.
Unless some of the transducers intentionally buffer input values, nothing is stored
in memory.

There is a paper about transducers transforming producers (like in this library):
(Lazy v. Yield: Incremental, Linear Pretty-printing)[http://okmij.org/ftp/continuations/PPYield/yield-pp.pdf]
from 2012 (the first mention of clojure transducers (transforming consumers) is
probably this 2014 [blog post](http://blog.cognitect.com/blog/2014/8/6/transducers-are-coming).
In the paper transducers are used to ensure linear complexity for pretty-printing
with hierarchical document encoding similar to the one employed by this library.

Using terminology from the paper stream of values is generated by _producer_.
For example it is a generator function reading data from channel and returning
chunks with `yield` expression. Or it may be just some `Array` passed to
input of transducers pipeline or anything iterable.

Results of computation are passed to _consumer_ function. `Array.from` is one of as
such function. It just writes all resulting values into in-memory array.
This may also be a function writing values into channel.

With help function's manipulation libraries like Ramda
creating and manipulating of such transducers is even simpler. For example
[pipe](http://ramdajs.com/docs/#pipe) function composes transducers into a
single one because transducers are just functions.

Here is a jquery example may be written using Ramda `pipe`:

```javascript
consume(R.comp(map(f),map(g))(produce()))
```

and next is absolutely the same: 

```javascript
consume(map(R.comp(f,g))(produce()))
```

i.e. no intermediate value, and execution of `f` and `g` is interleaved for each element
of input iterator.

## AST transducers

Unlike streams AST is hierarchical but we still can turn it into sequence. For
complex node it emits value for begin and end and children in between. This is
very similar to visitors where value hierarchy is flattened into corresponding
handlers call. So transducers and visitors are related like internals and
externals iterators.

The library doesn't export any transducers, it only exports producer and consumer as
functions:

 * `produce` - takes AST node and returns stream of AST traversal events
 * `consume` - takes stream and build AST node from it

It also exports `Tag` object for default AST field and type names.

Calling `consume` may be not necessary if AST is updated in place, however
this may be not a good idea.

The event stream is an object with following fields:
 * `enter` - boolean displaying traversal enters node
 * `leave` - boolean displaying traversal exits node
 * `value` - An object with original AST node value in `node` field, it is
             shared between `enter` and `leave`.
 * `pos` - name of the field, it is not a string but
           a special tag value, the default tags are
           in `Tag` map exported by the library
 * `type` - node type tag, like for `pos`

If it is node without children `enter` and `leave` are both true.

Here is an example of variable value substitution transducer.

```javascript
function* subst(dict, s) {
  for(const i of s) {
    switch (i.type) {
    case Tag.Identifier:
      const n = dict[i.value.node.name]
      if (n) {
        if (i.enter)
          yield* produce(n,i.pos)
        continue
      }
      break
    case Scope:
      if (i.enter) {
        dict = Object.create(dict)
        for (const j in i.value)
          dict[j] = false
      } else
        dict = Object.getPrototypeOf(dict)
      break
    }
    yield i
  }
}
```

This is pretty simple and comprehensible. No awareness of visitors library
protocol is required. For example top stop iteration visitors typically require
to signal it somehow, for example, with special value for function's result.
Here it is just plain javascript `break` statement.

An special node type (`Scope`) is handled here for variables with the same name but
defined in sub-functions definitions. If we don't want to touch them we may run
scope calculation transducer before, injecting such `Scope` nodes. They will be
ignored by `consume` function.

The usage is pretty simple, for example to rename `i` variables to `j':

```javascript
    consume(subst({i:{type:"Identifier", name: "j"}}, scope(produce(ast))))
```

Or much cleaner with Ramda:

```javascript
  R.pipe(
    produce,
    scope,
    subst({i:{type:"Identifier", name: "j"}}),
    consume
  )(ast)
```

There are more details in
[test/rename.js](https://github.com/awto/estree-transducers/blob/master/test/rename.js)

## LICENSE

Copyright © 2016,2017 Vitaliy Akimov

Distributed under the terms of The MIT License (MIT).


