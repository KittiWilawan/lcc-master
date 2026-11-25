"use dom";

import { useEffect, useEffectEvent } from 'react';
import type { DOMProps } from 'expo/dom';
import { decode } from 'base64-arraybuffer';
import { inferBodies } from '../lib/bodyPoseInference';
import type { Body } from '../lib/bodyPose';

interface Props {
  frame: { id: number; jpeg: string } | null;
  readWeights: () => Promise<string>;
  onResult: (id: number, result: Body[] | null) => Promise<void>;
  dom?: DOMProps;
}

// On phones this component runs in a separate WebView JS context with its own CPU backend.
export default function EnrollmentPoseProcessor({ frame, readWeights, onResult }: Props) {
  const loadWeights = useEffectEvent(async () => decode(await readWeights()));
  const deliver = useEffectEvent(onResult);
  const id = frame?.id;
  const jpeg = frame?.jpeg;
  useEffect(() => {
    if (id === undefined || !jpeg) return;
    let active = true;
    void inferBodies(jpeg, loadWeights).then(
      bodies => { if (active) void deliver(id, bodies); },
      () => { if (active) void deliver(id, null); },
    );
    return () => { active = false; };
  }, [id, jpeg]);
  return null;
}
