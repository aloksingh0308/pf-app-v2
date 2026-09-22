import { Image as ExpoImage, ImageContentFit, ImageStyle } from 'expo-image';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, StyleProp, StyleSheet, View, ViewStyle } from 'react-native';

type AppImageProps = {
  uri?: string;
  fallbackUri?: string;
  contentFit?: ImageContentFit;
  style?: StyleProp<ViewStyle>;
  containerStyle?: StyleProp<ViewStyle>;
  imageStyle?: StyleProp<ImageStyle>;
  loaderColor?: string;
};

const DEFAULT_FALLBACK = 'https://via.placeholder.com/400x300?text=Image';

export default function AppImage({
  uri,
  fallbackUri = DEFAULT_FALLBACK,
  contentFit = 'cover',
  style,
  containerStyle,
  imageStyle,
  loaderColor = '#f68712',
}: AppImageProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isFallbackActive, setIsFallbackActive] = useState(false);

  const sourceUri = useMemo(() => {
    const trimmed = String(uri || '').trim();
    if (!trimmed) return fallbackUri;
    return isFallbackActive ? fallbackUri : trimmed;
  }, [fallbackUri, isFallbackActive, uri]);

  useEffect(() => {
    setIsFallbackActive(false);
    setIsLoading(true);
  }, [uri]);

  return (
    <View style={[styles.container, style, containerStyle]}>
      <ExpoImage
        source={{ uri: sourceUri }}
        cachePolicy="memory-disk"
        contentFit={contentFit}
        transition={180}
        style={[StyleSheet.absoluteFillObject, imageStyle]}
        onLoadStart={() => setIsLoading(true)}
        onLoadEnd={() => setIsLoading(false)}
        onError={() => {
          if (!isFallbackActive && sourceUri !== fallbackUri) {
            setIsFallbackActive(true);
            return;
          }
          setIsLoading(false);
        }}
      />
      {isLoading ? (
        <View style={styles.loaderOverlay}>
          <ActivityIndicator size="small" color={loaderColor} />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#f3f3f3',
    overflow: 'hidden',
  },
  loaderOverlay: {
    ...StyleSheet.absoluteFillObject,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.45)',
  },
});
