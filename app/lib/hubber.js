import { remote } from 'electron'; // eslint-disable-line import/no-extraneous-dependencies
import architect from 'architect';
import log from 'electron-log';
import path from 'path';

class Hubber {
  constructor(store) {
    log.debug('Creating Hubber');

    this.store = store;
    this.startArchitect();
  }

  static setupIoT(services) {
    const thingShadows = services.iot.thingShadows;

    thingShadows.on('message', (requestTopic, requestPayloadJSON) => {
      log.debug(`received message on topic ${requestTopic}`, requestPayloadJSON.toString());
      const pluginName = requestTopic.split('/')[2];
      const requestPayload = JSON.parse(requestPayloadJSON);

      const responseTopic = `${requestTopic}/response`;
      let responsePayload = null;

      const plugin = services[pluginName];
      if (!plugin) {
        log.info(`plugin ${pluginName} not installed`);
        // TODO: log this and expose in web portal somehow or notify the user
        responsePayload = {
          status: 'error',
          message: 'plugin not installed',
          error_type: 'PLUGIN_NOT_INSTALLED',
        };
      } else {
        responsePayload = plugin.execute(requestPayload);
      }

      const responsePayloadJSON = JSON.stringify(responsePayload);

      thingShadows.publish(responseTopic, responsePayloadJSON);
    });
  }

  architectConfig() {
    const state = this.store.getState();

    const initialPlugins = state.plugins;

    const plugins = initialPlugins.map((plugin) => {
      if (typeof plugin === 'object') {
        return { ...plugin };
      }

      return plugin;
    });

    const configPlugin = {
      setup: (options, imports, register) => {
        register(null, {
          config: {
            get: (key) => {
              const localState = this.store.getState();
              return localState[key];
            },

            addPlugin: (pluginName) => {
              this.store.dispatch({
                type: 'PLUGINS_ADD',
                name: pluginName,
              });
            },
          },
        });
      },
      provides: ['config'],
      consumes: [],
    };

    plugins.push(configPlugin);

    const basePaths = [
      path.join(remote.app.getPath('userData'), 'hubber-plugins'),
      path.join(__dirname, '..'),
    ];
    const architectConfig = architect.resolveConfig(plugins, basePaths);

    return architectConfig;
  }

  startArchitect() {
    const config = this.architectConfig();

    const arch = architect.createApp(config, (err, app) => {
      if (err) {
        // TODO: Show some error in web app
        log.error('Could not start architect');
        log.error(err);
      }
      log.info('plugins ready');

      if (app.services.iot) {
        Hubber.setupIoT(app.services);
      }
    });

    arch.on('plugin', (plugin) => {
      log.debug(`Loaded plugin: provides: ${plugin.provides} path: ${plugin.packagePath}`);
    });
  }
}

export default Hubber;
