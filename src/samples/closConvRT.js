function Bind(inner, args) {
  this.inner = inner
  this.args = args
}

closure(Bind, function bind() {
  return this.inner.apply(this.inner,[].concat(this.args,arguments))
})

function bind() {
  return new Bind(this, arguments)
}

function apply(self, args) {
  return this.call.apply(this, [self].concat(args))
}

function constrImpl(func, args) {
  func.call.apply(func, [this].concat(args))
}

function constr() {
  return new constrImpl(this, arguments)
}

function closure(constructor,call) {
  var proto = constructor.prototype
  proto.length = call.length - 1
  proto.bind = bind
  proto.apply = apply
  proto.constr = constr
}

