import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CircleCheck } from "lucide-react";
import { describe, expect, it } from "vitest";
import { ICON_SIZE_CLASS, ICON_STROKE_WIDTH, Icon } from "./icon";

function render(props: React.ComponentProps<typeof Icon>) {
  return renderToStaticMarkup(React.createElement(Icon, props));
}

describe("Icon", () => {
  it("默认是装饰性图标：aria-hidden 且描边取统一值", () => {
    const html = render({ icon: CircleCheck });

    expect(html).toContain('aria-hidden="true"');
    expect(html).toContain(`stroke-width="${ICON_STROKE_WIDTH}"`);
  });

  it("按档位输出尺寸类", () => {
    expect(render({ icon: CircleCheck, size: "sm" })).toContain(ICON_SIZE_CLASS.sm);
    expect(render({ icon: CircleCheck, size: "xl" })).toContain(ICON_SIZE_CLASS.xl);
  });

  it("不传尺寸档位时完全交给容器或 className 控制", () => {
    const html = render({ icon: CircleCheck, className: "text-fg-45" });

    expect(html).toContain("text-fg-45");
    for (const sizeClass of Object.values(ICON_SIZE_CLASS)) {
      expect(html).not.toContain(sizeClass);
    }
  });

  it("传 label 时切换成可读语义", () => {
    const html = render({ icon: CircleCheck, label: "已恢复" });

    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="已恢复"');
    expect(html).not.toContain("aria-hidden");
  });

  it("允许单个图标覆盖描边宽度", () => {
    expect(render({ icon: CircleCheck, strokeWidth: 2 })).toContain('stroke-width="2"');
  });
});
