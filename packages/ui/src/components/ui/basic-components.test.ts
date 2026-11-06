import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Badge, badgeVariants } from "./badge";
import { Button, buttonVariants } from "./button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./card";
import { Input } from "./input";

describe("basic UI components", () => {
  it("renders button and badge variants including asChild buttons", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        "div",
        null,
        React.createElement(Button, { variant: "destructive", size: "lg", className: "extra" }, "Delete"),
        React.createElement(Button, { asChild: true, variant: "link" }, React.createElement("a", { href: "/docs" }, "Docs")),
        React.createElement(Badge, { variant: "warning", className: "badge-extra" }, "Warn")
      )
    );

    expect(html).toContain("Delete");
    expect(html).toContain("href=\"/docs\"");
    expect(html).toContain("Warn");
    expect(buttonVariants({ variant: "outline", size: "sm" })).toContain("h-8");
    // success 变体改用语义令牌：深浅两套主题各有一份值，不再直接写调色板
    expect(badgeVariants({ variant: "success" })).toContain("text-success-note-fg");
  });

  it("renders card sections and date/text inputs with merged classes", () => {
    const html = renderToStaticMarkup(
      React.createElement(
        Card,
        { className: "card-extra" },
        React.createElement(CardHeader, null, React.createElement(CardTitle, null, "Title"), React.createElement(CardDescription, null, "Desc")),
        React.createElement(CardContent, { className: "content-extra" }, "Body"),
        React.createElement(CardFooter, null, "Footer"),
        React.createElement(Input, { type: "date", value: "2026-06-06", readOnly: true }),
        React.createElement(Input, { type: "text", placeholder: "Name", disabled: true })
      )
    );

    expect(html).toContain("card-extra");
    expect(html).toContain("Title");
    expect(html).toContain("Desc");
    expect(html).toContain("content-extra");
    expect(html).toContain("type=\"date\"");
    expect(html).toContain("[-webkit-text-fill-color:var(--fg)]");
    expect(html).toContain("[color-scheme:var(--date-input-scheme)]");
    expect(html).toContain("placeholder=\"Name\"");
    expect(html).toContain("disabled=\"\"");
  });
});
