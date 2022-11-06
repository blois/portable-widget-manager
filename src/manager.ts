import {Loader} from './amd';
import {Comm, Context} from './api';
import * as outputs from './outputs';
import {
  WidgetModel,
  WidgetView,
  IClassicComm,
  DOMWidgetView,
  remove_buffers,
  put_buffers,
  BufferJSON,
  Dict,
} from '@jupyter-widgets/base';
import * as base from '@jupyter-widgets/base';
import {ManagerBase} from '@jupyter-widgets/base-manager';
import * as controls from '@jupyter-widgets/controls';
import * as services from '@jupyterlab/services';
import {JSONObject} from '@lumino/coreutils';
import {Message} from '@lumino/messaging';
import {Widget} from '@lumino/widgets';
import css from '../lib/index.css.txt';

export class Manager extends ManagerBase {
  private readonly models = new Map<string, Promise<WidgetModel>>();
  private readonly loader: Loader;

  constructor(private readonly context: Context, loader: Loader) {
    super();

    this.loader = loader;

    // Backbone's extend cannot iterate static properties on ES6 classes and
    // misses propagating them when subclassing.
    const backboneExtend = base.WidgetModel.extend;
    const extend = function (
      this: object,
      proto: object,
      statics: unknown
    ): any {
      const result = backboneExtend.call(this, proto, statics);
      // Use prototype inheritance of the classes so the statics are correctly
      // inherited.
      Object.setPrototypeOf(result, this);
      return result;
    };
    base.WidgetModel.extend = controls.ButtonModel.extend = extend;

    // https://github.com/googlecolab/colab-cdn-widget-manager/issues/12
    // Add pWidget for better compat with jupyter-widgets 4.0.0.
    if (!Object.getOwnPropertyDescriptor(DOMWidgetView.prototype, 'pWidget')) {
      Object.defineProperty(DOMWidgetView.prototype, 'pWidget', {
        get: function () {
          return this.luminoWidget;
        },
      });
    }

    // https://github.com/googlecolab/colab-cdn-widget-manager/issues/19
    // Add processPhosphorMessage for better compat with jupyter-widgets 4.0.0.
    if (
      !Object.getOwnPropertyDescriptor(
        DOMWidgetView.prototype,
        'processPhosphorMessage'
      )
    ) {
      Object.defineProperty(DOMWidgetView.prototype, 'processPhosphorMessage', {
        value: function () {},
        writable: true,
      });
    }

    this.loader.define('@jupyter-widgets/base', [], () => base);

    this.loader.define('@jupyter-widgets/controls', [], () => controls);

    this.loader.define('@jupyter-widgets/output', [], () => outputs);
  }

  protected async loadClass(
    className: string,
    moduleName: string,
    moduleVersion: string
  ): Promise<typeof WidgetModel | typeof WidgetView> {
    const exports = await this.loader.load(moduleName, moduleVersion);
    return (exports as {[key: string]: typeof WidgetModel | typeof WidgetView})[
      className
    ];
  }

  protected async _create_comm(
    comm_target_name: string,
    model_id?: string,
    data?: JSONObject,
    metadata?: JSONObject,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): Promise<IClassicComm> {
    const sendBuffers = buffers?.map((buffer) => {
      if (ArrayBuffer.isView(buffer)) {
        return new Uint8Array(
          buffer.buffer,
          buffer.byteOffset,
          buffer.byteLength
        );
      }
      return buffer;
    });

    throw new Error('_create_comm is not yet supported');

    // const comm = await this.context.openCommChannel(
    //   comm_target_name,
    //   data,
    //   sendBuffers
    // );
    // return new ClassicComm(model_id || '', comm);
  }

  /* eslint @typescript-eslint/ban-types: "off" */
  protected _get_comm_info(): Promise<{}> {
    throw new Error('Method not implemented.');
  }

  async get_model(modelId: string): Promise<WidgetModel> {
    let modelPromise = this.models.get(modelId);
    if (modelPromise) {
      return modelPromise;
    }
    modelPromise = (async () => {
      const states = await this.context.getModelState(modelId);
      const state = states.get(modelId);
      if (!state) {
        throw new Error('not found');
      }

      // Round-trip the state through Jupyter's remove_buffers/put_buffers to
      // normalize the buffer format.
      const serializedState = remove_buffers(state.state as BufferJSON);
      put_buffers(
        state.state as Dict<BufferJSON>,
        serializedState.buffer_paths,
        serializedState.buffers
      );

      let comm: ClassicComm|undefined = undefined;
      if (state.comm) {
        comm = new ClassicComm(modelId, state.comm);
      }

      const model = await this.new_model(
        {
          model_name: state.modelName,
          model_module: state.modelModule,
          model_module_version: state.modelModuleVersion || '',
          model_id: modelId,
          comm,
        },
        state.state
      );
      return model;
    })();
    this.models.set(modelId, modelPromise);
    return modelPromise;
  }

  async render(modelId: string, container: HTMLElement): Promise<void> {
    const model = (await this.get_model(modelId)) as WidgetModel;
    const view = await this.create_view(model);
    dispatchLuminoMessage(view.luminoWidget, {
      type: 'before-attach',
      isConflatable: false,
      conflate: () => false,
    });

    const lifecycleAdapter = new LuminoLifecycleAdapter(view.luminoWidget);
    const shadow = lifecycleAdapter.attachShadow({ mode: "open" });

    // Add the Jupyter Widgets CSS to the shadow DOM.
    const style = document.createElement('style');
    style.id = 'jupyter-portable-widgets-style';
    style.textContent = css;
    shadow.appendChild(style);

    // Some widgets rely on icons from font-awesome, so add that as well.
    const fontAwesome = document.createElement('link');
    fontAwesome.rel = 'stylesheet';
    fontAwesome.href =
    'https://cdn.jsdelivr.net/npm/font-awesome@4.7.0/css/font-awesome.min.css';
    shadow.appendChild(fontAwesome);

    shadow.appendChild(view.el);

    // lifecycleAdapter.appendChild(view.el);
    container.appendChild(lifecycleAdapter);
  }

  renderOutput(outputItem: unknown, destination: Element): Promise<void> {
    throw new Error('renderOutput is not yet supported');
    // return this.context.renderOutput(outputItem, destination);
  }

  async commChannelOpened(
    id: string,
    comm: Comm,
    data?: unknown,
    buffers?: ArrayBuffer[]
  ) {
    if (!data) {
      return;
    }
    const classicComm = new ClassicComm(id, comm);
    await this.handle_comm_open(classicComm, {
      header: {} as services.KernelMessage.IHeader<'comm_open'>,
      metadata: {version: base.PROTOCOL_VERSION},
      parent_header: {},
      channel: 'iopub',
      content: {
        comm_id: id,
        target_name: 'jupyter.widget',
        data: data as JSONObject,
      },
    });
  }
}

class ClassicComm implements IClassicComm {
  constructor(private readonly id: string, private readonly comm: Comm) {}
  get target_name() {
    return '';
  }

  open(
    data: any,
    callbacks: any,
    metadata?: any,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): string {
    // Comm channels should be opened through Manager._create_comm.
    throw new Error('Method not implemented.');
  }

  /* eslint @typescript-eslint/no-explicit-any: "off" */
  send(
    data: unknown,
    callbacks: any,
    metadata?: unknown,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): string {
    let opts: {buffers?: ArrayBuffer[]}|undefined = undefined;
    if (buffers) {
      const sendBuffers = buffers.map((buffer) => {
        if (ArrayBuffer.isView(buffer)) {
          return new Uint8Array(
            buffer.buffer,
            buffer.byteOffset,
            buffer.byteLength
          );
        }
        return buffer;
      });
      opts = {buffers: sendBuffers};
    }
    // Round-trip through JSON to drop non-transferrable properties. These will
    // throw errors when sent via a message channel, vs JSON.stringify which
    // will just skip.
    data = JSON.parse(JSON.stringify(data));
    this.comm.send(data, opts).then(() => {
      if (callbacks && callbacks.iopub && callbacks.iopub.status) {
        callbacks.iopub.status({
          content: {
            execution_state: 'idle',
          },
        });
      }
    });
    return '';
  }
  close(
    data?: unknown,
    callbacks?: unknown,
    metadata?: unknown,
    buffers?: ArrayBuffer[] | ArrayBufferView[]
  ): string {
    // Currently does not support data in the close.
    this.comm.close();
    return '';
  }

  on_msg(callback: (x: unknown) => void) {
    (async () => {
      if (!this.comm) {
        return;
      }
      for await (const message of this.comm.messages) {
        let buffers: Uint8Array[] = [];
        if (message.buffers) {
          // The comm callback is typed as ArrayBuffer|ArrayBufferView but
          // some code (pythreejs) require ArrayBufferViews.
          buffers = message.buffers.map((b) => new Uint8Array(b));
        }
        try {
          callback({
            content: {
              comm_id: this.id,
              data: message.data,
            },
            buffers: buffers,
          });
        } catch (error) {
          console.error(error);
        }
      }
    })();
  }

  on_close(callback: (x: unknown) => void): void {
    if (!this.comm) {
      return;
    }
    (async () => {
      // Wait for all messages to complete.
      /* eslint no-empty: "off", @typescript-eslint/no-unused-vars: "off" */
      for await (const message of this.comm.messages) {
      }
      callback(undefined);
    })();
  }

  get comm_id() {
    return this.id;
  }
}

/**
 * Custom element to provide Lumino lifecycle events driven by native DOM
 * events.
 */
class LuminoLifecycleAdapter extends HTMLElement {
  constructor(private readonly widget?: Widget) {
    super();
  }
  connectedCallback() {
    if (this.widget) {
      dispatchLuminoMessage(this.widget, {
        type: 'after-attach',
        isConflatable: false,
        conflate: () => false,
      });
    }
  }
  disconnectedCallback() {
    if (this.widget) {
      // We don't have a native event for before-detach, so just fire before
      // the after-detach.
      dispatchLuminoMessage(this.widget, {
        type: 'before-detach',
        isConflatable: false,
        conflate: () => false,
      });
      dispatchLuminoMessage(this.widget, {
        type: 'after-detach',
        isConflatable: false,
        conflate: () => false,
      });
    }
  }
}

function dispatchLuminoMessage(widget: Widget, message: Message) {
  widget.processMessage(message);
  const phosphorWidget = widget as MaybePhosphorWidget;
  if (phosphorWidget._view?.processPhosphorMessage) {
    phosphorWidget._view.processPhosphorMessage(message);
  }
}

declare interface MaybePhosphorWidget {
  _view?: MaybePhosphorView;
}

declare interface MaybePhosphorView {
  processPhosphorMessage?(message: Message): void;
}

try {
  window.customElements.define('portable-lumino-adapter', LuminoLifecycleAdapter);
} catch (error: unknown) {
  // May have already been defined.
}
