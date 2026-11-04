import React from 'react';
import { StyleSheet, View } from 'react-native';
import Animated, { StyleProps } from 'react-native-reanimated';
import { GestureDetector, PanGesture } from 'react-native-gesture-handler';
import { camera, TOUCH } from '../../theme';

interface ResizableBoundingBoxProps {
  animatedStyle: StyleProps;
  panBoxGesture: PanGesture;
  resizeTopLeftGesture: PanGesture;
  resizeTopRightGesture: PanGesture;
  resizeBottomLeftGesture: PanGesture;
  resizeBottomRightGesture: PanGesture;
}

const CORNER = 28;
const THICK = 4;

type Corner = 'tl' | 'tr' | 'bl' | 'br';

/** Équerre d'un coin du cadre : blanche, épaisse, avec une ombre pour rester visible sur le papier */
const Bracket: React.FC<{ corner: Corner }> = ({ corner }) => {
  const top = corner[0] === 't';
  const left = corner[1] === 'l';
  return (
    <View
      style={[
        styles.bracket,
        top ? { top: 0 } : { bottom: 0 },
        left ? { left: 0 } : { right: 0 },
        {
          borderTopWidth: top ? THICK : 0,
          borderBottomWidth: top ? 0 : THICK,
          borderLeftWidth: left ? THICK : 0,
          borderRightWidth: left ? 0 : THICK,
          borderTopLeftRadius: top && left ? 12 : 0,
          borderTopRightRadius: top && !left ? 12 : 0,
          borderBottomLeftRadius: !top && left ? 12 : 0,
          borderBottomRightRadius: !top && !left ? 12 : 0,
        },
      ]}
    />
  );
};

/** Cadre de lecture : le déplacer par le centre, l'ajuster par les coins */
export const ResizableBoundingBox: React.FC<ResizableBoundingBoxProps> = ({
  animatedStyle,
  panBoxGesture,
  resizeTopLeftGesture,
  resizeTopRightGesture,
  resizeBottomLeftGesture,
  resizeBottomRightGesture,
}) => {
  const handles: [Corner, PanGesture][] = [
    ['tl', resizeTopLeftGesture],
    ['tr', resizeTopRightGesture],
    ['bl', resizeBottomLeftGesture],
    ['br', resizeBottomRightGesture],
  ];
  return (
    <Animated.View
      style={[styles.box, animatedStyle]}
      accessible
      accessibilityLabel="Cadre de lecture"
      accessibilityHint="Place une seule formule dans le cadre. Fais glisser le cadre ou ses coins pour l'ajuster.">
      <GestureDetector gesture={panBoxGesture}>
        <View style={StyleSheet.absoluteFill} />
      </GestureDetector>
      <View style={styles.edge} pointerEvents="none" />
      {handles.map(([corner, gesture]) => (
        <GestureDetector key={corner} gesture={gesture}>
          <View
            style={[
              styles.handle,
              corner[0] === 't' ? { top: -TOUCH / 4 } : { bottom: -TOUCH / 4 },
              corner[1] === 'l' ? { left: -TOUCH / 4 } : { right: -TOUCH / 4 },
            ]}>
            <View style={styles.handleInner}>
              <Bracket corner={corner} />
            </View>
          </View>
        </GestureDetector>
      ))}
    </Animated.View>
  );
};

const styles = StyleSheet.create({
  box: { position: 'absolute', top: 0, left: 0, zIndex: 10 },
  edge: {
    ...StyleSheet.absoluteFillObject,
    borderColor: 'rgba(255, 255, 255, 0.55)',
    borderWidth: 1,
    borderRadius: 12,
  },
  handle: { position: 'absolute', width: TOUCH, height: TOUCH, zIndex: 20 },
  handleInner: { position: 'absolute', top: TOUCH / 4, left: TOUCH / 4, right: TOUCH / 4, bottom: TOUCH / 4 },
  bracket: {
    position: 'absolute',
    width: CORNER,
    height: CORNER,
    borderColor: camera.frame,
    shadowColor: '#000',
    shadowOpacity: 0.5,
    shadowRadius: 3,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },
});
