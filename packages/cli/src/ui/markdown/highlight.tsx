import { Text } from "ink";
import React from "react";
import type { Theme } from "../themes.js";

export function parseInlineMarkdown(text: string, theme: Theme): React.ReactNode[] {
  const parts: React.ReactNode[] = [];
  const regex = /(\*\*[^*]+\*\*|`[^`]+`)/g;
  const tokens = text.split(regex);

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (!token) continue;

    if (token.startsWith("**") && token.endsWith("**")) {
      parts.push(
        <Text key={i} bold color={theme.accent}>
          {token.slice(2, -2)}
        </Text>
      );
    } else if (token.startsWith("`") && token.endsWith("`")) {
      parts.push(
        <Text key={i} color="yellow">
          {token.slice(1, -1)}
        </Text>
      );
    } else {
      parts.push(<Text key={i}>{token}</Text>);
    }
  }

  return parts.length > 0 ? parts : [text];
}

export function highlightCodeLine(line: string, language: string, theme: Theme): React.ReactNode[] {
  const lowercaseLang = language.toLowerCase();

  let commentMatch = null;
  if (lowercaseLang === "python" || lowercaseLang === "bash" || lowercaseLang === "sh" || lowercaseLang === "yaml" || lowercaseLang === "dockerfile") {
    commentMatch = line.match(/^(.*?)(#.*)$/);
  } else {
    commentMatch = line.match(/^(.*?)(\/\/.*)$/);
  }

  if (commentMatch) {
    const codePart = commentMatch[1] ?? "";
    const commentPart = commentMatch[2] ?? "";
    return [
      ...highlightCodeCode(codePart, lowercaseLang, theme),
      <Text key="comment" color={theme.muted} italic>{commentPart}</Text>
    ];
  }

  return highlightCodeCode(line, lowercaseLang, theme);
}

export function highlightCodeCode(code: string, language: string, theme: Theme): React.ReactNode[] {
  const keywords = /\b(const|let|var|function|return|import|export|from|class|extends|if|else|for|while|do|switch|case|break|continue|try|catch|finally|async|await|def|import|as|from|print|in|is|not|and|or|elif|try|except|with|lambda)\b/g;
  const builtins = /\b(string|number|boolean|any|void|unknown|never|null|undefined|true|false|self|this|Object|Array|Promise|console)\b/g;
  const numbers = /\b(\d+(?:\.\d+)?)\b/g;

  const stringRegex = /(["'`].*?["'`])/g;
  const stringTokens = code.split(stringRegex);
  const elements: React.ReactNode[] = [];

  stringTokens.forEach((token, idx) => {
    if ((token.startsWith('"') && token.endsWith('"')) ||
        (token.startsWith("'") && token.endsWith("'")) ||
        (token.startsWith("`") && token.endsWith("`"))) {
      elements.push(<Text key={`str-${idx}`} color="green">{token}</Text>);
    } else {
      const subTokens = token.split(/(\s+|\b)/);
      subTokens.forEach((subToken, subIdx) => {
        const key = `sub-${idx}-${subIdx}`;
        if (subToken.match(keywords)) {
          elements.push(<Text key={key} color={theme.primary} bold>{subToken}</Text>);
        } else if (subToken.match(builtins)) {
          elements.push(<Text key={key} color={theme.accent}>{subToken}</Text>);
        } else if (subToken.match(numbers)) {
          elements.push(<Text key={key} color="magenta">{subToken}</Text>);
        } else {
          elements.push(<Text key={key}>{subToken}</Text>);
        }
      });
    }
  });

  return elements;
}
