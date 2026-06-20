/**
 * noocodec ESLint rules — ripper port.
 *
 * Three custom rules ported from the noocodec canonical implementations:
 *
 * - `noocodec/interface-must-be-contract`
 *     Flags any `interface` that carries no method/call/construct signature
 *     (a data-shape interface). Data shapes must become `type`. An `allow`
 *     option provides an allowlist for declaration-merge augmentation points.
 *     Source: Dagonizer/eslint-rules/noocodec.mjs `interfaceMustBeContract`.
 *     Ripper allowlist: empty by default; add only legitimate augmentation
 *     interfaces as they are discovered.
 *
 * - `noocodec/group-types-in-namespace`
 *     A file that declares two or more flat module-scope exported
 *     types/interfaces must group them inside a single `export namespace`.
 *     Source: noocodec-bot/eslint.config.mjs `groupTypesInNamespaceRule`.
 *     Exempt: test files, ripper's `src/types/` multi-export barrels,
 *     `src/nodes/**\/index.ts` and `src/**\/index.ts` barrel re-exports.
 *
 * - `noocodec/logger-binding-name`
 *     Enforces the binding-name convention on Logger construction:
 *     `Logger.forComponent(...)` must bind to `log` (or `#log`).
 *     There is no `.child(...)` method on ripper's Logger; the rule omits
 *     that branch rather than flagging unrelated call sites.
 *     Source: noocodec-bot/eslint.config.mjs `loggerBindingNameRule`,
 *     adapted to ripper's Logger API.
 *
 * Self-contained: imports only Node built-ins.
 *
 * Usage (flat config):
 *   import { noocodec } from './eslint-rules/noocodec.mjs';
 *   // plugins: { noocodec }
 *   // rules: { 'noocodec/interface-must-be-contract': 'error', ... }
 */

// ---------------------------------------------------------------------------
// Rule: interface-must-be-contract
// ---------------------------------------------------------------------------

const interfaceMustBeContract = {
  meta: {
    messages: {
      dataShapeMustBeType:
        "Interface '{{name}}' has no method/call/construct signatures. Per the type-substrate rule, data shapes must be declared as `type` in src/types/; `interface` is reserved for behavioral/class contracts and the allowlisted augmentation points.",
    },
    schema: [
      {
        properties: {
          allow: {
            items: { type: 'string' },
            type: 'array',
          },
        },
        type: 'object',
      },
    ],
    type: 'problem',
  },
  create(context) {
    const allow = new Set(context.options[0]?.allow ?? []);

    return {
      TSInterfaceDeclaration(node) {
        if (allow.has(node.id.name)) {
          return;
        }

        // NOTE: TSPropertySignature with a TSFunctionType typeAnnotation is a
        // function-valued FIELD (data), NOT behavioral. Do NOT count it.
        const hasBehavioralMember = node.body.body.some((member) => {
          return (
            member.type === 'TSMethodSignature' ||
            member.type === 'TSCallSignatureDeclaration' ||
            member.type === 'TSConstructSignatureDeclaration'
          );
        });

        if (!hasBehavioralMember) {
          context.report({
            data: { name: node.id.name },
            messageId: 'dataShapeMustBeType',
            node: node.id,
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rule: group-types-in-namespace
//
// Adapted from noocodec-bot's `groupTypesInNamespaceRule`.
//
// Exempt list for ripper:
//   - test files (tests/**/*.ts, *.test.ts)
//   - src/types/ barrel files — these are intentional multi-export type
//     files; ripper uses one type per file convention there but the rule
//     must not double-flag files that already get caught by interface-must-be-contract.
//     More precisely: each src/types/*.ts file typically exports 1–3 tightly
//     related types (e.g. Config.ts has ResolvedCacheConfigInterface +
//     NormalizedRipperConfigInterface). These ARE candidates for namespacing
//     under the eventual rename, but the scope report needs to capture them
//     as groupTypesInNamespace violations, not suppress them.
//   - index.ts barrel files (re-export only, not type declarations)
//   - examples/** (no examples dir in ripper, but kept for parity)
// ---------------------------------------------------------------------------

const groupTypesInNamespace = {
  meta: {
    messages: {
      groupInNamespace:
        'This file declares {{count}} flat module-scope types/interfaces ({{names}}). Group related types inside a single `export namespace` (the entity convention), instead of multiple flat top-level declarations.',
    },
    schema: [],
    type: 'problem',
  },
  create(context) {
    const filename = context.filename;

    // Exempt: test files and example files
    if (
      /\/tests?\//.test(filename) ||
      /\.test\.ts$/.test(filename) ||
      /\/examples\//.test(filename)
    ) {
      return {};
    }

    // Exempt: index.ts barrel files (they re-export, not declare)
    if (/\/index\.ts$/.test(filename)) {
      return {};
    }

    const loose = [];
    const record = (node) => {
      const exportDecl = node.parent;
      if (!exportDecl || exportDecl.type !== 'ExportNamedDeclaration') {
        return;
      }
      if (exportDecl.parent.type !== 'Program') {
        return; // inside a namespace/block → fine
      }
      loose.push(node);
    };

    return {
      TSTypeAliasDeclaration(node) {
        record(node);
      },
      TSInterfaceDeclaration(node) {
        record(node);
      },
      'Program:exit'() {
        if (loose.length > 1) {
          context.report({
            data: {
              count: loose.length,
              names: loose.map((n) => { return n.id.name; }).join(', '),
            },
            messageId: 'groupInNamespace',
            node: loose[1].id,
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Rule: logger-binding-name
//
// Adapted from noocodec-bot's `loggerBindingNameRule` for ripper's Logger API.
//
// Ripper's Logger class exposes:
//   - `Logger.forComponent(name)` — must bind to `log` or `#log`
//
// There is no `.child(...)` method on ripper's Logger; the childLog check
// is omitted to avoid false positives on unrelated `.child` calls.
//
// Logger-typed parameters and fields are also enforced: any binding whose
// type annotation is `Logger` must be named `log` / `#log`.
//
// Test and example files are exempt.
// ---------------------------------------------------------------------------

function isLoggerTypeAnnotation(typeAnnotation) {
  return (
    typeAnnotation &&
    typeAnnotation.typeAnnotation &&
    typeAnnotation.typeAnnotation.type === 'TSTypeReference' &&
    typeAnnotation.typeAnnotation.typeName.type === 'Identifier' &&
    typeAnnotation.typeAnnotation.typeName.name === 'Logger'
  );
}

function calleePropertyName(init) {
  if (
    init &&
    init.type === 'CallExpression' &&
    init.callee.type === 'MemberExpression' &&
    init.callee.property.type === 'Identifier'
  ) {
    return init.callee.property.name;
  }
  return null;
}

const loggerBindingName = {
  meta: {
    messages: {
      baseMustBeLog:
        "A `Logger.forComponent(...)` binding must be named `log` (or `#log` for a private field), not `{{name}}` (logging standard).",
      loggerSlotMustBeLog:
        "A `Logger`-typed {{kind}} must be named `log` / `#log`, not `{{name}}` (the class/module logger is always `log`).",
    },
    schema: [],
    type: 'problem',
  },
  create(context) {
    const filename = context.filename;
    if (
      /\/tests?\//.test(filename) ||
      /\.test\.ts$/.test(filename) ||
      /\/examples\//.test(filename)
    ) {
      return {};
    }

    const isLogName = (name) => { return name === 'log' || name === '#log'; };

    return {
      // Variable declarations: `const logger = Logger.forComponent(...)`
      VariableDeclarator(node) {
        if (node.id.type !== 'Identifier') {
          return;
        }
        const prop = calleePropertyName(node.init);
        if (prop === 'forComponent' && node.id.name !== 'log') {
          context.report({
            data: { name: node.id.name },
            messageId: 'baseMustBeLog',
            node: node.id,
          });
        }
      },

      // Class property definitions: `readonly log = Logger.forComponent(...)`
      // or `#log = Logger.forComponent(...)` or Logger-typed fields
      PropertyDefinition(node) {
        if (
          node.key.type !== 'Identifier' &&
          node.key.type !== 'PrivateIdentifier'
        ) {
          return;
        }
        const name =
          node.key.type === 'PrivateIdentifier'
            ? `#${node.key.name}`
            : node.key.name;
        const prop = calleePropertyName(node.value);
        const looksLikeLogger =
          prop === 'forComponent' || isLoggerTypeAnnotation(node.typeAnnotation);
        if (looksLikeLogger && !isLogName(name)) {
          context.report({
            data: { name, kind: 'field' },
            messageId: 'loggerSlotMustBeLog',
            node: node.key,
          });
        }
      },

      // Function/arrow/method parameters typed as Logger
      'FunctionDeclaration > Identifier.params, ArrowFunctionExpression > Identifier.params, FunctionExpression > Identifier.params, TSParameterProperty > Identifier'(
        node,
      ) {
        if (
          node.type !== 'Identifier' ||
          !isLoggerTypeAnnotation(node.typeAnnotation)
        ) {
          return;
        }
        if (node.name !== 'log') {
          context.report({
            data: { name: node.name, kind: 'parameter' },
            messageId: 'loggerSlotMustBeLog',
            node,
          });
        }
      },
    };
  },
};

// ---------------------------------------------------------------------------
// Plugin export
// ---------------------------------------------------------------------------

/** The noocodec ESLint plugin for ripper — register under the `noocodec` namespace. */
export const noocodec = {
  meta: { name: 'noocodec' },
  rules: {
    'interface-must-be-contract': interfaceMustBeContract,
    'group-types-in-namespace':   groupTypesInNamespace,
    'logger-binding-name':        loggerBindingName,
  },
};
