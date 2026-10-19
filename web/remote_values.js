// Remote Float / Remote String / Remote Boolean (GeN13): mirror nodes, see web/remote_core.js
import { registerRemote } from "./remote_core.js";

registerRemote({ nodeId: "RemoteFloatGeN13", extName: "gen13.remote_float", stepPicker: true });
registerRemote({ nodeId: "RemoteStringGeN13", extName: "gen13.remote_string", textBox: true });
registerRemote({ nodeId: "RemoteBooleanGeN13", extName: "gen13.remote_boolean" });
