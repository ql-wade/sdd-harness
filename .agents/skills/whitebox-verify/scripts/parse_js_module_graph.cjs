"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { stripTypeScriptTypes } = require("node:module");

let acorn;
try {
  acorn = require("internal/deps/acorn/acorn/dist/acorn");
} catch (error) {
  process.stderr.write(`Node Acorn parser unavailable: ${error.message}\n`);
  process.exit(2);
}

function stringValue(node) {
  if (node && node.type === "Literal" && typeof node.value === "string") {
    return node.value;
  }
  if (
    node &&
    node.type === "TemplateLiteral" &&
    node.expressions.length === 0 &&
    node.quasis.length === 1
  ) {
    return node.quasis[0].value.cooked;
  }
  return null;
}

function unwrap(node) {
  let current = node;
  const wrappers = new Set([
    "ChainExpression",
    "ParenthesizedExpression",
    "TSAsExpression",
    "TSNonNullExpression",
    "TSTypeAssertion",
  ]);
  while (current && wrappers.has(current.type)) {
    current = current.expression;
  }
  return current;
}

function memberPropertyName(node) {
  if (!node || node.type !== "MemberExpression") return null;
  if (!node.computed && node.property && node.property.type === "Identifier") {
    return node.property.name;
  }
  return stringValue(node.property);
}

function loaderKind(callee) {
  const node = unwrap(callee);
  if (node && node.type === "Identifier" && node.name === "require") {
    return "require";
  }
  if (node && node.type === "MemberExpression") {
    const object = unwrap(node.object);
    const property = memberPropertyName(node);
    if (
      object && object.type === "Identifier" &&
      ((["module", "globalThis"].includes(object.name) && property === "require") ||
        (object.name === "require" && property === "resolve"))
    ) {
      return `${object.name}.${property}`;
    }
  }
  return null;
}

function parseAst(file) {
  const options = {
    allowAwaitOutsideFunction: true,
    allowHashBang: true,
    ecmaVersion: "latest",
    sourceType: "module",
  };
  try {
    return acorn.parse(file.source, options);
  } catch (firstError) {
    const suffix = path.extname(file.path).toLowerCase();
    if (![".ts", ".tsx"].includes(suffix) || typeof stripTypeScriptTypes !== "function") {
      throw firstError;
    }
    const stripped = stripTypeScriptTypes(file.source, { mode: "strip", sourceMap: false });
    return acorn.parse(stripped, options);
  }
}

function inspectFile(file) {
  const specifiers = new Set();
  const errors = [];
  const allowedLoaderIdentifiers = new WeakSet();
  const interceptionMembers = new Set(["fulfill", "route", "routeFromHAR"]);
  const interceptionConfigKeys = new Set(["proxy", "serviceWorkers"]);
  let ast;
  try {
    ast = parseAst(file);
  } catch (error) {
    return {
      path: file.path,
      specifiers: [],
      errors: [`AST parser rejected source: ${error.message}`],
    };
  }

  function addSpecifier(node, kind) {
    const value = stringValue(node);
    if (typeof value !== "string" || value.length === 0) {
      errors.push(`${kind} uses a computed module specifier`);
      return;
    }
    specifiers.add(value);
  }

  function allowDirectLoaderIdentifiers(node) {
    if (!node || typeof node !== "object") return;
    if (node.type === "Identifier" && node.name === "require") {
      allowedLoaderIdentifiers.add(node);
    }
    for (const [key, value] of Object.entries(node)) {
      if (["start", "end", "loc"].includes(key)) continue;
      if (Array.isArray(value)) {
        for (const child of value) allowDirectLoaderIdentifiers(child);
      } else if (value && typeof value === "object") {
        allowDirectLoaderIdentifiers(value);
      }
    }
  }

  function walk(node) {
    if (!node || typeof node !== "object") return;

    if (
      node.type === "ImportDeclaration" ||
      node.type === "ExportAllDeclaration" ||
      node.type === "ExportNamedDeclaration"
    ) {
      if (node.source) addSpecifier(node.source, node.type);
    } else if (node.type === "ImportExpression") {
      addSpecifier(node.source, "import()");
    } else if (node.type === "CallExpression") {
      const kind = loaderKind(node.callee);
      if (kind) {
        allowDirectLoaderIdentifiers(node.callee);
        if (node.arguments.length !== 1) {
          errors.push(`${kind} must have exactly one static string argument`);
        } else {
          addSpecifier(node.arguments[0], kind);
        }
      }
      const callee = unwrap(node.callee);
      if (callee && callee.type === "Identifier" && ["eval", "Function"].includes(callee.name)) {
        errors.push(`${callee.name} dynamic code execution cannot close a route graph`);
      }
    } else if (node.type === "NewExpression") {
      const callee = unwrap(node.callee);
      if (callee && callee.type === "Identifier" && callee.name === "Function") {
        errors.push("Function dynamic code execution cannot close a route graph");
      }
    }

    if (node.type === "Identifier") {
      if (node.name === "require" && !allowedLoaderIdentifiers.has(node)) {
        errors.push("indirect require reference cannot close a route graph");
      }
      if (["createRequire", "eval", "Function"].includes(node.name)) {
        errors.push(`indirect ${node.name} reference cannot close a route graph`);
      }
      if (node.name === "routeFromHAR") {
        errors.push("browser interception/replay behavior uses routeFromHAR");
      }
    }

    if (node.type === "MemberExpression") {
      const property = memberPropertyName(node);
      if (interceptionMembers.has(property)) {
        errors.push(`browser interception/replay behavior uses member '${property}'`);
      }
      if (["eval", "Function"].includes(property)) {
        errors.push(`indirect ${property} member cannot close a route graph`);
      }
      const object = unwrap(node.object);
      if (
        node.computed && property === null && object && object.type === "Identifier" &&
        ["context", "page", "route"].includes(object.name)
      ) {
        errors.push("browser interception/replay behavior uses a computed browser member");
      }
    }

    if (node.type === "Property") {
      const key = node.computed ? stringValue(node.key) : node.key && node.key.name;
      if (interceptionConfigKeys.has(key) || interceptionMembers.has(key)) {
        errors.push(`browser interception/replay behavior declares key '${key}'`);
      }
    }

    for (const [key, value] of Object.entries(node)) {
      if (key === "start" || key === "end" || key === "loc") continue;
      if (Array.isArray(value)) {
        for (const child of value) walk(child);
      } else if (value && typeof value === "object") {
        walk(value);
      }
    }
  }

  walk(ast);
  return {
    path: file.path,
    specifiers: [...specifiers].sort(),
    errors: [...new Set(errors)].sort(),
  };
}

let input;
try {
  input = JSON.parse(fs.readFileSync(0, "utf8"));
} catch (error) {
  process.stderr.write(`Invalid parser input: ${error.message}\n`);
  process.exit(2);
}

if (!input || !Array.isArray(input.files)) {
  process.stderr.write("Parser input must contain files[]\n");
  process.exit(2);
}

process.stdout.write(JSON.stringify({ files: input.files.map(inspectFile) }));
