import { ResizeMode, Video } from 'expo-av';
import styled from "styled-components/native";

const SplashScreen = () => {
  return (
    <Container>
      <BackgroundVideo />
    </Container>
  );
}

export default SplashScreen;

const Container = styled.View`
  flex: 1;
  justify-content: center;
  align-items: center;
  background-color: #000;
`;

const BackgroundVideo = styled(Video).attrs({
  source: require('../assets/images/splash_video.mp4'),
  shouldPlay: true,
  isLooping: true,
  isMuted: false,
  resizeMode: ResizeMode.COVER,
})`
  width: 100%;
  height: 100%;
`;
