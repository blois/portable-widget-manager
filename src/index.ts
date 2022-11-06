import {Loader} from './amd';
import {IOutput, Context} from './api';
import {Manager} from './manager';

export async function render(output: IOutput, element: HTMLDivElement, context: Context): Promise<void> {
  const loader = new Loader();
  const manager = new Manager(context, loader);
  const widgetData = output.data['application/vnd.jupyter.widget-view+json'];
  const modelId = widgetData['model_id'];
  console.log(`===== rendering output: `, output);
  manager.render(modelId, element);
}
