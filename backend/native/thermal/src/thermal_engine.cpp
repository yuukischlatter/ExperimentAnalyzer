#include <opencv2/opencv.hpp>
#include <unordered_map>
#include <vector>
#include <string>
#include <fstream>
#include <sstream>
#include <iostream>
#include <cmath>

class ThermalEngine {
private:
    cv::VideoCapture cap;
    std::unordered_map<uint32_t, float> tempMapping;
    cv::Mat currentFrame;
    int totalFrames;
    double fps;
    int frameWidth;
    int frameHeight;
    int lastFrameNumber = -1;

    // Pack RGB values into a single uint32_t for hash map key
    uint32_t packRGB(int r, int g, int b) {
        return (static_cast<uint32_t>(r) << 16) | 
               (static_cast<uint32_t>(g) << 8) | 
               static_cast<uint32_t>(b);
    }

    // Bresenham's line algorithm for pixel interpolation
    std::vector<std::pair<int, int>> getLinePixels(int x1, int y1, int x2, int y2) {
        std::vector<std::pair<int, int>> pixels;
        
        int dx = abs(x2 - x1);
        int dy = abs(y2 - y1);
        int sx = (x1 < x2) ? 1 : -1;
        int sy = (y1 < y2) ? 1 : -1;
        int err = dx - dy;
        
        int x = x1, y = y1;
        
        while (true) {
            // Ensure pixel is within frame bounds
            if (x >= 0 && x < frameWidth && y >= 0 && y < frameHeight) {
                pixels.push_back({x, y});
            }
            
            if (x == x2 && y == y2) break;
            
            int e2 = 2 * err;
            if (e2 > -dy) {
                err -= dy;
                x += sx;
            }
            if (e2 < dx) {
                err += dx;
                y += sy;
            }
        }
        
        return pixels;
    }

public:
    ThermalEngine() : totalFrames(0), fps(0), frameWidth(0), frameHeight(0) {}
    
    ~ThermalEngine() {
        if (cap.isOpened()) {
            cap.release();
        }
    }

    bool loadVideo(const std::string& path) {
        try {
            cap.open(path);
            
            if (!cap.isOpened()) {
                std::cerr << "Error: Could not open video file: " << path << std::endl;
                return false;
            }
            
            totalFrames = static_cast<int>(cap.get(cv::CAP_PROP_FRAME_COUNT));
            fps = cap.get(cv::CAP_PROP_FPS);
            frameWidth = static_cast<int>(cap.get(cv::CAP_PROP_FRAME_WIDTH));
            frameHeight = static_cast<int>(cap.get(cv::CAP_PROP_FRAME_HEIGHT));
            
            std::cout << "Video loaded successfully:" << std::endl;
            std::cout << "  Frames: " << totalFrames << std::endl;
            std::cout << "  FPS: " << fps << std::endl;
            std::cout << "  Resolution: " << frameWidth << "x" << frameHeight << std::endl;
            
            return true;
            
        } catch (const std::exception& e) {
            std::cerr << "Exception loading video: " << e.what() << std::endl;
            return false;
        }
    }

    bool loadTempMapping(const std::string& csvPath) {
        try {
            std::ifstream file(csvPath);
            if (!file.is_open()) {
                std::cerr << "Error: Could not open temperature mapping file: " << csvPath << std::endl;
                return false;
            }
            
            std::string line;
            std::getline(file, line); // Skip header line
            
            int count = 0;
            while (std::getline(file, line)) {
                std::stringstream ss(line);
                std::string cell;
                std::vector<std::string> row;
                
                // Parse CSV line
                while (std::getline(ss, cell, ',')) {
                    row.push_back(cell);
                }
                
                if (row.size() >= 6) { // X,Y,R,G,B,Temperature_C
                    try {
                        int r = std::stoi(row[2]);
                        int g = std::stoi(row[3]);
                        int b = std::stoi(row[4]);
                        float temp = std::stof(row[5]);
                        
                        // Validate RGB values
                        if (r >= 0 && r <= 255 && g >= 0 && g <= 255 && b >= 0 && b <= 255) {
                            uint32_t key = packRGB(r, g, b);
                            tempMapping[key] = temp;
                            count++;
                        }
                    } catch (const std::exception& e) {
                        // Skip invalid lines
                        continue;
                    }
                }
            }
            
            file.close();
            
            std::cout << "Temperature mapping loaded: " << count << " entries" << std::endl;
            return count > 0;
            
        } catch (const std::exception& e) {
            std::cerr << "Exception loading temperature mapping: " << e.what() << std::endl;
            return false;
        }
    }

    cv::Mat getFrame(int frameNumber) {
        try {
            if (!cap.isOpened()) {
                std::cerr << "Error: Video not loaded" << std::endl;
                return cv::Mat();
            }
            
            // Clamp frame number to valid range
            frameNumber = std::max(0, std::min(frameNumber, totalFrames - 1));
            
            // Only seek if we need a different frame
            if (frameNumber != lastFrameNumber) {
                cap.set(cv::CAP_PROP_POS_FRAMES, frameNumber);
                
                if (!cap.read(currentFrame)) {
                    std::cerr << "Error: Could not read frame " << frameNumber << std::endl;
                    return cv::Mat();
                }
                
                lastFrameNumber = frameNumber;
            }
            
            return currentFrame;
            
        } catch (const std::exception& e) {
            std::cerr << "Exception getting frame: " << e.what() << std::endl;
            return cv::Mat();
        }
    }

    float getPixelTemperature(int r, int g, int b) {
        uint32_t key = packRGB(r, g, b);
        auto it = tempMapping.find(key);
        
        if (it != tempMapping.end()) {
            return it->second;
        }
        
        // If exact match not found, find closest RGB match
        float minDistance = std::numeric_limits<float>::max();
        float closestTemp = -1.0f;
        
        for (const auto& pair : tempMapping) {
            uint32_t mapKey = pair.first;
            int mapR = (mapKey >> 16) & 0xFF;
            int mapG = (mapKey >> 8) & 0xFF;
            int mapB = mapKey & 0xFF;
            
            // Calculate Euclidean distance in RGB space
            float distance = std::sqrt(
                std::pow(r - mapR, 2) + 
                std::pow(g - mapG, 2) + 
                std::pow(b - mapB, 2)
            );
            
            if (distance < minDistance) {
                minDistance = distance;
                closestTemp = pair.second;
                
                // If very close, use it immediately
                if (distance < 10.0f) {
                    break;
                }
            }
        }
        
        return closestTemp;
    }

    std::vector<float> analyzeLine(int frameNumber, int x1, int y1, int x2, int y2) {
        std::vector<float> temperatures;
        
        try {
            cv::Mat frame = getFrame(frameNumber);
            if (frame.empty()) {
                std::cerr << "Error: Could not get frame for analysis" << std::endl;
                return temperatures;
            }
            
            // Get pixels along the line
            std::vector<std::pair<int, int>> linePixels = getLinePixels(x1, y1, x2, y2);
            
            // Analyze each pixel
            for (const auto& pixel : linePixels) {
                int x = pixel.first;
                int y = pixel.second;
                
                // Get BGR values (OpenCV uses BGR, not RGB)
                cv::Vec3b bgr = frame.at<cv::Vec3b>(y, x);
                int b = bgr[0];
                int g = bgr[1];
                int r = bgr[2];
                
                float temp = getPixelTemperature(r, g, b);
                
                if (temp >= 0) {
                    temperatures.push_back(temp);
                } else {
                    // Use interpolated value or skip
                    temperatures.push_back(0.0f);
                }
            }
            
        } catch (const std::exception& e) {
            std::cerr << "Exception analyzing line: " << e.what() << std::endl;
        }
        
        return temperatures;
    }

    // Getter functions for video properties
    int getTotalFrames() const { return totalFrames; }
    double getFPS() const { return fps; }
    int getFrameWidth() const { return frameWidth; }
    int getFrameHeight() const { return frameHeight; }
    bool isVideoLoaded() const { return cap.isOpened(); }
    
    // Get video info as a structure
    struct VideoInfo {
        int frames;
        double fps;
        int width;
        int height;
        bool loaded;
    };
    
    VideoInfo getVideoInfo() const {
        return {
            totalFrames,
            fps,
            frameWidth,
            frameHeight,
            cap.isOpened()
        };
    }
};