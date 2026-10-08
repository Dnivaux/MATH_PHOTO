import { useSharedValue, useAnimatedStyle, runOnJS } from 'react-native-reanimated';
import { Gesture } from 'react-native-gesture-handler';

export interface BoundingBoxRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NormalizedCropRegion {
  originX: number; // [0, 1] relative to screen/preview
  originY: number; // [0, 1] relative to screen/preview
  width: number;   // [0, 1]
  height: number;  // [0, 1]
}

interface UseResizableBoxOptions {
  screenWidth: number;
  screenHeight: number;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  onRegionChange?: (region: NormalizedCropRegion) => void;
}

export const useResizableBox = ({
  screenWidth,
  screenHeight,
  initialWidth = 300,
  initialHeight = 140,
  minWidth = 140,
  minHeight = 80,
  onRegionChange,
}: UseResizableBoxOptions) => {
  // Center initial position
  const initialX = (screenWidth - initialWidth) / 2;
  const initialY = (screenHeight - initialHeight) / 2;

  const boxX = useSharedValue(initialX);
  const boxY = useSharedValue(initialY);
  const boxWidth = useSharedValue(initialWidth);
  const boxHeight = useSharedValue(initialHeight);

  // Context for translation gestures
  const startX = useSharedValue(initialX);
  const startY = useSharedValue(initialY);
  const startW = useSharedValue(initialWidth);
  const startH = useSharedValue(initialHeight);

  const notifyRegion = () => {
    'worklet';
    if (onRegionChange) {
      const region: NormalizedCropRegion = {
        originX: Math.max(0, Math.min(1, boxX.value / screenWidth)),
        originY: Math.max(0, Math.min(1, boxY.value / screenHeight)),
        width: Math.max(0, Math.min(1, boxWidth.value / screenWidth)),
        height: Math.max(0, Math.min(1, boxHeight.value / screenHeight)),
      };
      runOnJS(onRegionChange)(region);
    }
  };

  // Whole box pan gesture (moving the box)
  const panBoxGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = boxX.value;
      startY.value = boxY.value;
    })
    .onUpdate((event) => {
      const nextX = startX.value + event.translationX;
      const nextY = startY.value + event.translationY;

      // Bound checks
      boxX.value = Math.max(16, Math.min(screenWidth - boxWidth.value - 16, nextX));
      boxY.value = Math.max(80, Math.min(screenHeight - boxHeight.value - 120, nextY));
      notifyRegion();
    });

  // Corner Resize: Bottom-Right
  const resizeBottomRightGesture = Gesture.Pan()
    .onStart(() => {
      startW.value = boxWidth.value;
      startH.value = boxHeight.value;
    })
    .onUpdate((event) => {
      const newWidth = Math.max(minWidth, Math.min(screenWidth - boxX.value - 16, startW.value + event.translationX));
      const newHeight = Math.max(minHeight, Math.min(screenHeight - boxY.value - 120, startH.value + event.translationY));
      boxWidth.value = newWidth;
      boxHeight.value = newHeight;
      notifyRegion();
    });

  // Corner Resize: Bottom-Left
  const resizeBottomLeftGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = boxX.value;
      startW.value = boxWidth.value;
      startH.value = boxHeight.value;
    })
    .onUpdate((event) => {
      const maxDeltaX = startW.value - minWidth;
      const deltaX = Math.max(-startX.value + 16, Math.min(maxDeltaX, event.translationX));
      boxX.value = startX.value + deltaX;
      boxWidth.value = startW.value - deltaX;

      const newHeight = Math.max(minHeight, Math.min(screenHeight - boxY.value - 120, startH.value + event.translationY));
      boxHeight.value = newHeight;
      notifyRegion();
    });

  // Corner Resize: Top-Right
  const resizeTopRightGesture = Gesture.Pan()
    .onStart(() => {
      startY.value = boxY.value;
      startW.value = boxWidth.value;
      startH.value = boxHeight.value;
    })
    .onUpdate((event) => {
      const maxDeltaY = startH.value - minHeight;
      const deltaY = Math.max(-startY.value + 80, Math.min(maxDeltaY, event.translationY));
      boxY.value = startY.value + deltaY;
      boxHeight.value = startH.value - deltaY;

      const newWidth = Math.max(minWidth, Math.min(screenWidth - boxX.value - 16, startW.value + event.translationX));
      boxWidth.value = newWidth;
      notifyRegion();
    });

  // Corner Resize: Top-Left
  const resizeTopLeftGesture = Gesture.Pan()
    .onStart(() => {
      startX.value = boxX.value;
      startY.value = boxY.value;
      startW.value = boxWidth.value;
      startH.value = boxHeight.value;
    })
    .onUpdate((event) => {
      const maxDeltaX = startW.value - minWidth;
      const deltaX = Math.max(-startX.value + 16, Math.min(maxDeltaX, event.translationX));
      boxX.value = startX.value + deltaX;
      boxWidth.value = startW.value - deltaX;

      const maxDeltaY = startH.value - minHeight;
      const deltaY = Math.max(-startY.value + 80, Math.min(maxDeltaY, event.translationY));
      boxY.value = startY.value + deltaY;
      boxHeight.value = startH.value - deltaY;
      notifyRegion();
    });

  const animatedBoxStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: boxX.value },
      { translateY: boxY.value },
    ],
    width: boxWidth.value,
    height: boxHeight.value,
  }));

  const getCropRect = (): BoundingBoxRect => ({
    x: boxX.value,
    y: boxY.value,
    width: boxWidth.value,
    height: boxHeight.value,
  });

  return {
    boxX,
    boxY,
    boxWidth,
    boxHeight,
    animatedBoxStyle,
    panBoxGesture,
    resizeTopLeftGesture,
    resizeTopRightGesture,
    resizeBottomLeftGesture,
    resizeBottomRightGesture,
    getCropRect,
  };
};
