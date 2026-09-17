"""同步递归阅读器的公共模块与合成示例，或只检查离线模板是否一致。"""
import argparse
import sys
from pathlib import Path


class ChineseParser(argparse.ArgumentParser):
    def format_help(self):
        return super().format_help().replace("usage:", "用法：").replace("options:", "选项：")

    def error(self, message):
        self.exit(2, "参数错误：仅支持 --check 或 --help；收到：" + " ".join(sys.argv[1:]) + "\n")


def replace_block(html, name, content):
    start = f"/* {name}_START */"
    end = f"/* {name}_END */"
    if html.count(start) != 1 or html.count(end) != 1:
        raise ValueError(f"模板需要且只能有一组 {name} 标记")
    begin = html.index(start)
    finish = html.index(end, begin) + len(end)
    return html[:begin] + start + "\n" + content.rstrip("\n") + "\n" + end + html[finish:]


def main():
    parser = ChineseParser(description=__doc__, add_help=False)
    parser.add_argument("-h", "--help", action="help", help="显示帮助并退出")
    parser.add_argument("--check", action="store_true", help="只检查，不写入模板")
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    target = root / "assets/buffer-design-template.html"
    sources = [
        ("RECURSIVE_STYLE", "recursive-reader.css"),
        ("RECURSIVE_CORE", "recursive-memory.js"),
        ("MEMORY_CASE", "example-model.js"),
        ("RECURSIVE_READER", "recursive-reader.js"),
    ]
    original = target.read_text(encoding="utf-8")
    expected = original
    changed = []
    for marker, filename in sources:
        updated = replace_block(expected, marker, (root / "assets" / filename).read_text(encoding="utf-8"))
        if updated != expected:
            changed.append(filename)
        expected = updated
    if args.check:
        if expected != original:
            raise SystemExit("模板内嵌内容不同步：" + "、".join(changed) + "；请运行 sync_template.py")
        print("通过：离线模板的样式、递归核心、阅读器和合成示例均与规范源一致；未写入文件。")
        return
    if expected != original:
        target.write_text(expected, encoding="utf-8")
        print("已同步离线模板：" + "、".join(changed) + "。")
    else:
        print("离线模板已与四份规范源一致，无需写入。")


if __name__ == "__main__":
    try:
        main()
    except (OSError, ValueError) as error:
        raise SystemExit("同步失败：" + str(error))
