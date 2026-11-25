import { Asset } from 'expo-asset';
import { File } from 'expo-file-system';

export async function readBodyPoseWeights(): Promise<ArrayBuffer> {
  // Metro resolves bundled binary assets by a static require.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const asset = await Asset.fromModule(require('../../assets/pose/group1-shard1of1.bin')).downloadAsync();
  const location = asset.localUri ?? asset.uri;
  return location.startsWith('file:') ? await new File(location).arrayBuffer() : await (await fetch(location)).arrayBuffer();
}
