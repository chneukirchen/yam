load('yam.js')

var $code = []

function Cons(name, value) {
  this.name = name
  this.value = value
  this.toString = function() {
    return name + "(" + value.toString() + ")"
  }
}

function serialize(o) {
  if (typeof (o) == "number") {
    return o.toString()
  } else if (typeof (o) == "string") {
    var s = o.toSource()
    return s.substring(12, s.length-2)
  } else {
    return o.toSource()
  }
}

function assert(t, str) {
  if (!t)
    throw("assert failed: " + str)
}

function compile(str) {
  var cu = CompilationUnit(ps(str))
  var expr = cu.ast
  
  if (!cu)
    throw("syntax error, can't parse")

  if (cu.remaining.length > 0) {
    print(cu.toSource())
    throw("syntax error: " +
          cu.remaining.input.substr(0, cu.remaining.index) + " **> " +
          cu.remaining.input.substr(cu.remaining.index, cu.remaining.length) +
          " <**")
  }

  $code = []
  for (var i = 0; i < expr.length; i++)
    compile_expr(expr[i])
  return $code.join("")
}

function emit(code) { $code.push(code) }

function mangle(t) {
  return t.replace(/[^a-zA-Z0-9]/g, function(match) {
                     return "_" + match.charCodeAt(0)
                   })
}

function emit_matchers(expr, prefix) {
  switch (expr.type) {
  case "var":
    break               // nothing to do
  case "lit":
    emit("&& " + prefix + " === " + serialize(expr.expr) + " ")
    break
  case "cons":
    emit("&& " + prefix + " instanceof Cons && " + prefix + ".name === " + serialize(expr.name) + " ")
    emit_matchers(expr.expr, prefix + ".value" + " ")
    break
  case "tuple":
    emit("&& " + prefix + " instanceof Array ")
    for (var i = 0; i < expr.elts.length; i++)
      emit_matchers(expr.elts[i], prefix + "[" + i + "]")
    break
  case "guard":
    emit(" && function(){")
    emit_assigners(expr, prefix)
    emit("return ")
    compile_expr(expr.guard)
    emit("}() ")
    break
  default:
    throw("can't match " + expr.type)
  }
}

function emit_assigners(expr, prefix) {
  switch (expr.type) {
  case "lit":
    break                       // do nothing
  case "cons":
    emit_assigners(expr.expr, prefix + ".value")
    break
  case "var":
    emit("var " + mangle(expr.name) + " = " + prefix + "; ");
    break
  case "tuple":
    for (var i = 0; i < expr.elts.length; i++)
      emit_assigners(expr.elts[i], prefix + "[" + i + "]")
    break
  case "guard":
    for (var i = 0; i < expr.term.length; i++)
      emit_assigners(expr.term[i], "_" + i)   // leaky abstraction
    break
  default:
    throw("can't emit assigners for " + expr.type)
  }
}

function compile_expr(e) {
  switch (e.type) {
  case "noop":
    break
  case "app":
    emit("(")
    compile_expr(e.expr)
    emit(")(")
    compile_expr(e.arg)
    emit(")")
    break
  case "var":
    emit(mangle(e.name))
    break
  case "lit":
    emit(serialize(e.expr))
    break
  case "let":
    emit("(function(")
    emit(e.bindings.map(function(v){return mangle(v[0])}).join(","))
    emit("){return ")
    compile_expr(e.expr)
    emit("})(")
    for (var i = 0; i < e.bindings.length; i++) {
      compile_expr(e.bindings[i][1])
      if (i < e.bindings.length-1)
        emit(",")
    }
    emit(")")
    break
  case "def":
    for (var i = 0; i < e.bindings.length; i++) {
      emit("; var " + mangle(e.bindings[i][0]) + " = (")
      compile_expr(e.bindings[i][1])
      emit("); ")
    }
    break
  case "module":
    emit("(function(){ ")
    var exported = []
    for (var i = 0; i < e.exprs.length; i++) {
      compile_expr(e.exprs[i])
      if (e.exprs[i].type == "def")
        for (var j = 0; j < e.exprs[i].bindings.length; j++)
          exported.push(e.exprs[i].bindings[j][0])
    }

    emit("return {")
    for (var i = 0; i < exported.length; i++) {
      emit(mangle(exported[i]) + ": " + mangle(exported[i]))
      if (i < exported.length-1)
        emit(", ")
    }
    emit("} })()")
    break
  case "fn":
    //assert(e.fns.length == 1, "single fn only yet")
    if (0 && e.fns.length == 1) {
      var fn = e.fns[0]
      for (var i = 0; i < fn.args.length; i++) {
        emit("function(")
        assert(fn.args[i].type == "var", "simple var bind only yet")
        emit(fn.args[i].name)
        emit("){return ")
      }
      compile_expr(fn.expr)
      for (var i = 0; i < fn.args.length; i++)
        emit("}")
    } else {
      var a = e.fns[0]
      var n_arg = a.args.length // assume they all have same
                                // number of arguments

      if (a.args[0].type == "guard")   // leaky abstraction
        n_arg = a.args[0].term.length

      for (var i = 0; i < n_arg-1; i++)
        emit("function(_" + i + "){return ")
      emit("function(_" + (n_arg-1) + "){ ")

      //  compile matchers
      emit("if (0) {")
      for (fi = 0; fi < e.fns.length; fi++) {
        var fn = e.fns[fi]
        emit("} else if (1 ")
        for (var i = 0; i < fn.args.length; i++)
          emit_matchers(fn.args[i], "_" + i)
        emit(") { ")

        // compile assigners
        for (var i = 0; i < fn.args.length; i++)
          emit_assigners(fn.args[i], "_" + i)

        emit("return ")
        compile_expr(fn.expr)
        emit(" ")
      }

      emit("} else { throw('Non-exhaustive patterns') } ")

      for (var i = 0; i < n_arg; i++)
        emit("}")
    }
    break
  case "seq":
    for (var i = 0; i < e.exprs.length; i++) {
      compile_expr(e.exprs[i])
      if (i != e.exprs.length - 1)
        emit(", ")
    }
    break
  case "tuple":
    emit("[")
    for (var i = 0; i < e.elts.length; i++) {
      compile_expr(e.elts[i])
      emit(",")
    }
    emit("]")
    break
  case "record":
    emit("{")
    for (var i = 0; i < e.elts.length; i++) {
      emit(mangle(e.elts[i][0]))
      emit(": ")
      compile_expr(e.elts[i][1])
      if (i < e.elts.length-1)
        emit(",")
    }
    emit("}")
    break
  case "cons":
    emit("(new Cons('")
    emit(e.name)
    emit("', ")
    compile_expr(e.expr)
    emit("))")
    break
  case "sel":
    emit("(")
    compile_expr(e.expr)
    emit(")[")
    emit(serialize(e.field))
    emit("]")
    break
  case "raw":
    emit("(" + e.code + ")")
    break
  default:
    throw "undefined type in compile_expr: " + e.toSource()
  }
}
