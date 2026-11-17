cmake_minimum_required(VERSION 3.22.1)
project(pocketlauncher)

add_library(pocketlauncher SHARED launcher.cpp)
target_compile_features(pocketlauncher PUBLIC cxx_std_17)
find_library(log-lib log)
target_link_libraries(pocketlauncher ${log-lib})
