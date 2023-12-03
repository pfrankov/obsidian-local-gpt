import {RangeSetBuilder} from "@codemirror/state";
import {
  Decoration,
  DecorationSet,
  EditorView,
  PluginSpec,
  PluginValue,
  ViewPlugin,
  ViewUpdate,
  WidgetType,
} from "@codemirror/view";

class Spinner extends WidgetType {
  toDOM() {
    const span = document.createElement("span");
    span.addClasses(["loading", "dots"]);
    span.setAttribute("id", "tg-loading");
    return span;
  }
}

export class SpinnerPlugin implements PluginValue {
  decorations: DecorationSet;
  listOfPositions: number[];
  editorView: EditorView;

  constructor(view: EditorView) {
    this.editorView = view;
    this.listOfPositions = [];
    this.decorations = this.buildDecorations();
  }

  show(position: number): Function {
    this.listOfPositions.push(position);
    this.decorations = this.buildDecorations();

    return () => {
      this.hide(position);
    }
  }

  hide(position: number) {
    this.listOfPositions = this.listOfPositions.filter(pos => pos !== position);
    this.decorations = this.buildDecorations();
  }

  update(update: ViewUpdate) {
    if (update.docChanged || update.viewportChanged) {
      this.decorations = this.buildDecorations();
    }
  }

  destroy() {}

  buildDecorations(): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    this.listOfPositions.forEach((pos) => {
      const indentationWidget = Decoration.widget({
        widget: new Spinner(),
      });
      const line = this.editorView.state.doc.lineAt(pos);
      builder.add(line.to, line.to, indentationWidget);
    });
    return builder.finish();
  }
}

const pluginSpec: PluginSpec<SpinnerPlugin> = {
  decorations: (value: SpinnerPlugin) => value.decorations,
};

export const spinnerPlugin = ViewPlugin.fromClass(SpinnerPlugin, pluginSpec);
