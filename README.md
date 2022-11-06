# portable-widget-manager

# Development

Install and run the development server:

```shell
npm install
npm run server
```

Then from a notebook:

```python
import IPython

_WIDGET_MIME_TYPE = 'application/vnd.jupyter.widget-view+json'

def _widget_display_hook(msg):
    content = msg.get('content', {})
    if not content:
        return msg
    data = content.get('data', {})
    widget_data = data.get(_WIDGET_MIME_TYPE)
    if not widget_data:
        return msg
    
    content['data'] = data
    data['application/vnd.jupyter.es6-rich-output'] = 'http://127.0.0.1:9897/manager.dev.js'
    
    return msg
    
    
IPython.get_ipython().display_pub.register_hook(_widget_display_hook)

import ipywidgets as widgets
s = widgets.IntSlider()

display(s)
```
